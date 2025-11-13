#!/usr/bin/env python3
"""
Flask Backend pour AI Cleaner WebApp - Compatible Python 3.14
API + WebSocket pour updates temps réel
"""

from __future__ import annotations

# PATCH pour Python 3.14 : Restaurer pkgutil.get_loader
import importlib
import importlib.util
import os
import pkgutil
import re
import sys
import unicodedata
import zipfile
from typing import List, Optional, Set, Tuple

try:
    from PyPDF2 import PdfReader
except Exception:  # pragma: no cover - PyPDF2 optional fallback
    PdfReader = None  # type: ignore

FORCE_PKGUTIL_SHIM = os.getenv("FORCE_PKGUTIL_SHIM") == "1"
NEEDS_PKGUTIL_SHIM = FORCE_PKGUTIL_SHIM or not hasattr(pkgutil, 'get_loader') or sys.version_info >= (3, 14)


def _safe_pkgutil_get_loader(name: str) -> Optional[importlib.abc.Loader]:  # type: ignore[attr-defined]
    """Compatibilité Python 3.14 pour pkgutil.get_loader.

    Python 3.14 supprime pkgutil.get_loader (voir notes de version CPython 3.14),
    ce shim restaure l'ancien comportement en renvoyant None au lieu de lever
    ValueError lorsque __main__.__spec__ est absent. Ref: docs Python 3.14 -
    https://docs.python.org/3.14/whatsnew/3.14.html#removed
    """

    try:
        spec = importlib.util.find_spec(name)
    except (ValueError, ImportError):
        # Python 3.14 peut lever ValueError si __spec__ est None (ex: __main__)
        # ou ImportError si le module n'existe pas. Dans ces cas, on renvoie None
        # pour imiter l'ancien comportement de pkgutil.get_loader.
        return None

    return spec.loader if spec else None


if NEEDS_PKGUTIL_SHIM:
    pkgutil.get_loader = _safe_pkgutil_get_loader

from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import threading
import requests

# Créer le dossier static s'il n'existe pas
SCRIPT_DIR = Path(__file__).parent
STATIC_DIR = SCRIPT_DIR / 'static'
STATIC_DIR.mkdir(exist_ok=True)

# Créer index.html s'il n'existe pas
INDEX_HTML = STATIC_DIR / 'index.html'
if not INDEX_HTML.exists():
    print("⚠️  index.html manquant dans static/")
    print("   Crée le fichier static/index.html avec le contenu du frontend")

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path='/static')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Session HTTP réutilisable
session = requests.Session()

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://localhost:11434').rstrip('/')
OLLAMA_TIMEOUT = float(os.getenv('OLLAMA_TIMEOUT', '20'))


def _ollama_endpoint(path: str) -> str:
    if not path.startswith('/'):
        path = '/' + path
    return f"{OLLAMA_URL}{path}"

# État global
state = {
    'scanning': False,
    'analyzing': False,
    'total_files': 0,
    'scanned_files': 0,
    'analyzed_files': 0,
    'candidates': [],
    'results': [],
    'stats': {},
    'files': [],
    'protected_files': [],
    'last_scan_path': None
}

scan_cancel_event = threading.Event()
analyze_cancel_event = threading.Event()

IGNORED_DIRS = {
    'node_modules', '.git', '.venv', 'venv', '__pycache__',
    'Library', 'VirtualBox VMs', 'Parallels', 'Steam',
    '.Trash', '.cache', '.npm', 'Applications', 'System'
}

SKIP_EXTS = {'.DS_Store', '.localized', '.tmp', '.cache', '.log'}

# 🛡️ MOTS-CLÉS PROTÉGÉS - NE JAMAIS SUPPRIMER
PROTECTED_KEYWORDS = [
    'antecedent', 'antécédent', 'medical', 'médical', 'sante', 'santé',
    'ordonnance', 'consultation', 'suivi', 'traitement', 'resultat', 'résultat',
    'facture', 'invoice', 'recu', 'reçu', 'receipt',
    'ticket', 'billet', 'concert', 'reservation', 'réservation',
    'cv', 'lettre', 'motivation', 'contrat', 'attestation', 'certificat',
    'important', 'urgent', 'confidentiel'
]

CRITICAL_CONTENT_RULES = [
    {
        'label': 'invoice_or_receipt',
        'reason': 'Invoice / receipt wording detected in the document body.',
        'keywords': [
            'facture', 'invoice', 'reçu', 'receipt', 'tva', 'taxe', 'montant dû',
            'amount due', 'total due', 'numéro de facture', 'order reference',
            'référence commande', 'paiement', 'payment reference'
        ],
    },
    {
        'label': 'ticket_or_booking',
        'reason': 'Ticket / reservation details detected (travel or concert proof).',
        'keywords': [
            'ticket', 'billet', 'boarding pass', 'qr code', 'reservation',
            'réservation', 'check-in', 'seat', 'vol', 'flight', 'train', 'concert',
            'spectacle', 'booking reference', 'passager', 'passenger'
        ],
    },
    {
        'label': 'bank_or_finance',
        'reason': 'Bank / payment statement detected (IBAN, RIB, transfer).',
        'keywords': [
            'iban', 'bic', 'swift', 'rib', 'relevé de compte', 'bank account',
            'account number', 'numéro de compte', 'carte bancaire', 'credit card',
            'debit card', 'virement', 'transfer', 'banque', 'paiement', 'payment'
        ],
    },
    {
        'label': 'credentials',
        'reason': 'Credentials or password detected in the text.',
        'keywords': [
            'mot de passe', 'password', 'login', 'identifiant', 'username',
            '2fa', 'otp', 'code de sécurité', 'security code', 'recovery code',
            'code de récupération', 'facebook', 'gmail', 'outlook', 'compte',
            'connexion', 'authenticator'
        ],
    },
    {
        'label': 'administrative',
        'reason': 'Administrative / legal wording detected (attestation, contract).',
        'keywords': [
            'attestation', 'certificat', 'contrat', 'assurance', 'justificatif',
            'ministere', 'ministère', 'securité sociale', 'sécurité sociale',
            'urssaf', 'impots', 'impôts', 'fiscal', 'siret', 'sirene'
        ],
    },
]

CRITICAL_CONTENT_REGEX = [
    (re.compile(r'\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b'), 'IBAN-like sequence detected.'),
    (re.compile(r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b'), 'Credit card style number detected.'),
]

SHORT_KEYWORD_MAX_LEN = 3

SCREENSHOT_PATTERNS = [
    'capture d\'écran',
    'capture d’écran',
    'capture d\'ecran',
    'screen shot',
    'screenshot',
    'スクリーンショット',
    '截圖',
    'screencap'
]

TEMPORARY_FILE_HINTS = ['tmp', 'temp', 'untitled', 'copy', 'copie', 'test', 'draft']
ARCHIVE_EXTENSIONS = {'.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.tar.gz'}

CATEGORIES = {
    'Images': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic'},
    'Videos': {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv'},
    'Audio': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'},
    'Documents': {'.pdf', '.doc', '.docx', '.txt', '.rtf', '.pages'},
    'Archives': {'.zip', '.rar', '.7z', '.tar', '.gz', '.dmg'},
    'Code': {'.py', '.js', '.html', '.css', '.java', '.cpp', '.sh'},
    'Installers': {'.pkg', '.dmg', '.app', '.exe'},
}

SIMPLE_TEXT_EXTS = {
    '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.ini', '.cfg', '.conf', '.html',
    '.htm', '.xml', '.yaml', '.yml', '.tex', '.rtf'
}

def human_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}TB"

def get_category(ext):
    ext = ext.lower()
    for cat, exts in CATEGORIES.items():
        if ext in exts:
            return cat
    return 'Autres'

def _normalize(text: str) -> str:
    return unicodedata.normalize('NFKD', text).casefold()


def is_protected(filename):
    """Vérifie si un fichier contient un mot-clé protégé avec précision."""

    normalized_name = _normalize(filename)
    tokens = [token for token in re.split(r'[^a-z0-9]+', normalized_name) if token]

    for keyword in PROTECTED_KEYWORDS:
        normalized_keyword = _normalize(keyword)

        if len(normalized_keyword) <= SHORT_KEYWORD_MAX_LEN:
            if any(token == normalized_keyword for token in tokens):
                return True, keyword
        else:
            if normalized_keyword in normalized_name:
                return True, keyword

    return False, None


def detect_critical_content(preview: Optional[str]) -> Optional[str]:
    """Détecte des contenus critiques dans l'aperçu texte."""

    if not preview:
        return None

    normalized_preview = _normalize(preview)

    for rule in CRITICAL_CONTENT_RULES:
        for keyword in rule['keywords']:
            normalized_keyword = _normalize(keyword)
            if normalized_keyword in normalized_preview:
                return f"{rule['reason']} (keyword '{keyword}')"

    for pattern, reason in CRITICAL_CONTENT_REGEX:
        if pattern.search(preview):
            return reason

    return None


def _looks_like_screenshot(name: str) -> bool:
    lowered = name.lower()
    return any(keyword in lowered for keyword in SCREENSHOT_PATTERNS)


def _list_neighbor_files(file_info, max_neighbors: int = 5) -> Tuple[str, List[str]]:
    path = file_info.get('path')
    if not path:
        return 'unknown', []

    target = Path(path)
    parent = target.parent
    neighbors: List[str] = []

    try:
        entries = sorted(parent.iterdir(), key=lambda p: p.name.lower())
        for entry in entries:
            if entry.name == target.name:
                continue
            neighbors.append(entry.name)
            if len(neighbors) >= max_neighbors:
                break
    except OSError:
        return str(parent), neighbors

    return str(parent), neighbors


def apply_local_rules(file_info, preview: Optional[str]) -> Optional[dict]:
    """Return an immediate verdict for trivial cases before invoking the LLM."""

    name = file_info.get('name', '')
    name_lower = name.lower()
    age_days = file_info.get('age', 0)
    ext = file_info.get('ext', '').lower()
    size = file_info.get('size', 0)
    category = file_info.get('category') or get_category(ext)

    if _looks_like_screenshot(name):
        if age_days >= 2 or category == 'Images':
            return {
                'importance': 'low',
                'can_delete': True,
                'reason': 'Screenshot-style filename matched (safe to delete unless flagged earlier).'
            }

    if any(hint in name_lower for hint in TEMPORARY_FILE_HINTS) and age_days >= 30:
        return {
            'importance': 'low',
            'can_delete': True,
            'reason': 'Filename indicates temporary/test content older than 30 days.'
        }

    if ext in ARCHIVE_EXTENSIONS and age_days >= 180 and size < 500 * 1024 * 1024:
        return {
            'importance': 'low',
            'can_delete': True,
            'reason': 'Archive older than 6 months with no protected keywords.'
        }

    if preview and 'draft' in preview.lower() and age_days >= 60:
        return {
            'importance': 'low',
            'can_delete': True,
            'reason': 'Text preview indicates an old draft with no critical keywords.'
        }

    return None


def _clean_preview_text(text: str, max_chars: int = 600) -> Optional[str]:
    if not text:
        return None

    condensed = re.sub(r'\s+', ' ', text)
    condensed = condensed.replace('```', '` ` `').strip()

    if not condensed:
        return None

    return condensed[:max_chars]


def _extract_plain_text_preview(path: str, max_chars: int = 600) -> Optional[str]:
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as handle:
            snippet = handle.read(max_chars * 4)
    except OSError:
        return None

    return _clean_preview_text(snippet, max_chars)


def _extract_rtf_preview(path: str, max_chars: int = 600) -> Optional[str]:
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as handle:
            snippet = handle.read(max_chars * 6)
    except OSError:
        return None

    snippet = re.sub(r'{\\.*?}', ' ', snippet)
    snippet = re.sub(r'\\[a-zA-Z]+-?\d* ?', ' ', snippet)
    return _clean_preview_text(snippet, max_chars)


def _extract_docx_preview(path: str, max_chars: int = 600) -> Optional[str]:
    try:
        with zipfile.ZipFile(path) as archive:
            with archive.open('word/document.xml') as doc_xml:
                raw = doc_xml.read().decode('utf-8', errors='ignore')
    except (OSError, KeyError, zipfile.BadZipFile):
        return None

    text = re.sub(r'<[^>]+>', ' ', raw)
    return _clean_preview_text(text, max_chars)


def _extract_pdf_preview(path: str, max_chars: int = 600) -> Optional[str]:
    if PdfReader is not None:
        try:
            reader = PdfReader(path)
            text_parts: List[str] = []

            for page in reader.pages[:3]:
                page_text = page.extract_text() or ''
                text_parts.append(page_text)
                if len(' '.join(text_parts)) >= max_chars * 2:
                    break

            combined = ' '.join(text_parts)
            preview = _clean_preview_text(combined, max_chars)
            if preview:
                return preview
        except Exception as exc:
            print(f"⚠️ PyPDF2 preview fallback for {path}: {exc}")

    try:
        with open(path, 'rb') as handle:
            data = handle.read(131072)
    except OSError:
        return None

    chunks = re.findall(rb'\(([^)]+)\)', data)
    if not chunks:
        return None

    decoded = ' '.join(part.decode('latin-1', errors='ignore') for part in chunks)
    return _clean_preview_text(decoded, max_chars)


def extract_text_preview(file_info, max_chars: int = 600) -> Optional[str]:
    path = file_info.get('path')
    ext = file_info.get('ext', '').lower()

    if not path or not ext:
        return None

    if ext in {'.docx'}:
        return _extract_docx_preview(path, max_chars)

    if ext == '.pdf':
        return _extract_pdf_preview(path, max_chars)

    if ext == '.rtf':
        return _extract_rtf_preview(path, max_chars)

    if ext in SIMPLE_TEXT_EXTS:
        return _extract_plain_text_preview(path, max_chars)

    if ext in {'.doc'}:
        # Les fichiers .doc binaires ne sont pas triviaux à lire sans dépendances
        # externes. On tente une lecture texte simple au cas où il s'agit d'un
        # document enregistré en mode texte.
        return _extract_plain_text_preview(path, max_chars)

    return None


def ensure_ollama_ready(model: str) -> None:
    """Vérifie la disponibilité d'Ollama et du modèle demandé."""

    tags_url = _ollama_endpoint('/api/tags')

    try:
        resp = session.get(tags_url, timeout=5)
    except requests.RequestException as exc:  # pragma: no cover - dépend réseau
        raise RuntimeError(
            f"Impossible de contacter Ollama sur {OLLAMA_URL}. "
            "Installez-le via https://ollama.com/download puis lancez `ollama serve`."
        ) from exc

    if resp.status_code != 200:
        raise RuntimeError(
            f"Ollama répond HTTP {resp.status_code} sur {OLLAMA_URL}. "
            "Assurez-vous que `ollama serve` est en cours d'exécution."
        )

    try:
        tags_payload = resp.json()
    except ValueError as exc:  # pragma: no cover - JSON invalide inattendu
        raise RuntimeError("Réponse inattendue d'Ollama (JSON invalide)") from exc

    available_models = {
        item.get('name')
        for item in tags_payload.get('models', [])
        if item.get('name')
    }

    if model in available_models:
        return

    show_url = _ollama_endpoint('/api/show')

    try:
        show_resp = session.post(show_url, json={'name': model}, timeout=5)
    except requests.RequestException as exc:  # pragma: no cover
        raise RuntimeError(
            f"Impossible d'initialiser le modèle {model} sur Ollama. "
            "Vérifiez que le service est lancé."
        ) from exc

    if show_resp.status_code == 404:
        raise RuntimeError(
            f"Le modèle '{model}' est absent. Exécutez `ollama pull {model}` puis réessayez."
        )

    if show_resp.status_code != 200:
        raise RuntimeError(
            f"Erreur Ollama lors du chargement du modèle '{model}' (HTTP {show_resp.status_code})."
        )

def scan_directory(path, min_age_days=30, min_size_mb=20, cancel_event=None, allowed_categories: Optional[Set[str]] = None):
    """Scan rapide avec os.scandir"""
    stats = defaultdict(lambda: {'count': 0, 'size': 0})
    candidates = []
    protected_files = []
    total = 0
    
    def scan_recursive(dir_path):
        if cancel_event and cancel_event.is_set():
            return

        nonlocal total
        try:
            with os.scandir(dir_path) as entries:
                for entry in entries:
                    if cancel_event and cancel_event.is_set():
                        return

                    if entry.name.startswith('.'):
                        continue

                    if entry.is_dir(follow_symlinks=False):
                        if entry.name in IGNORED_DIRS:
                            continue
                        scan_recursive(entry.path)

                    elif entry.is_file(follow_symlinks=False):
                        if cancel_event and cancel_event.is_set():
                            return

                        ext = os.path.splitext(entry.name)[1]
                        if ext in SKIP_EXTS:
                            continue
                        
                        try:
                            stat = entry.stat()
                            total += 1
                            
                            # Emit progress
                            if total % 100 == 0:
                                socketio.emit('scan_progress', {
                                    'scanned': total,
                                    'message': f'Scan en cours... {total} fichiers'
                                })
                            
                            size = stat.st_size
                            age_days = (datetime.now().timestamp() - stat.st_mtime) / 86400
                            category = get_category(ext)

                            if allowed_categories and category not in allowed_categories:
                                continue

                            stats[category]['count'] += 1
                            stats[category]['size'] += size

                            # 🛡️ PROTECTION: Ne pas ajouter si mot-clé protégé
                            protected, keyword = is_protected(entry.name)
                            if protected:
                                print(f"🛡️ PROTÉGÉ: {entry.name} (mot-clé: {keyword})")
                                protected_files.append({
                                    'path': entry.path,
                                    'name': entry.name,
                                    'ext': ext,
                                    'size': size,
                                    'age': int(age_days),
                                    'category': category,
                                    'keyword': keyword
                                })
                                continue
                            
                            # Candidat ?
                            if (age_days > min_age_days or 
                                size > min_size_mb * 1024 * 1024 or
                                any(w in entry.name.lower() for w in ['screenshot', 'capture', 'untitled', 'download'])):
                                
                                candidates.append({
                                    'path': entry.path,
                                    'name': entry.name,
                                    'ext': ext,
                                    'size': size,
                                    'age': int(age_days),
                                    'category': category
                                })
                        except OSError:
                            pass
        except PermissionError:
            pass
    
    scan_recursive(path)
    
    return {
        'total_files': total,
        'stats': dict(stats),
        'candidates': sorted(candidates, key=lambda x: x['age'], reverse=True),
        'protected': sorted(protected_files, key=lambda x: x['name'].lower())
    }

def _load_json_loose(json_str: str) -> Tuple[Optional[dict], Optional[Exception]]:
    """Tente de charger du JSON puis applique de petites réparations si besoin."""

    try:
        return json.loads(json_str), None
    except json.JSONDecodeError as exc:
        cleaned = json_str.replace("\\'", "'")

        if cleaned != json_str:
            try:
                repaired = json.loads(cleaned)
                print("🛠️ JSON nettoyé (apostrophes dé-échappées)")
                return repaired, None
            except json.JSONDecodeError as exc2:
                return None, exc2

        return None, exc


def call_ollama(prompt, model="llama3:8b") -> Tuple[Optional[dict], Optional[str]]:
    """Appel Ollama optimisé"""
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 100,
            "top_k": 10,
            "top_p": 0.5,
            "num_ctx": 512,
            "num_thread": os.cpu_count() or 8,
            "repeat_penalty": 1.1
        }
    }

    try:
        resp = session.post(_ollama_endpoint('/api/generate'), json=payload, timeout=OLLAMA_TIMEOUT)
    except requests.RequestException as exc:
        error_message = (
            f"Ollama introuvable sur {OLLAMA_URL}. Lancez `ollama serve` ou installez le modèle {model}."
        )
        print(f"❌ {error_message}: {exc}")
        return None, error_message

    if resp.status_code != 200:
        try:
            error_payload = resp.json()
            detail = error_payload.get('error') or error_payload
        except ValueError:
            detail = resp.text[:200]
        error_message = f"Ollama HTTP {resp.status_code}: {detail}"
        print(f"❌ {error_message}")
        return None, error_message

    try:
        data = resp.json()
    except ValueError as exc:
        error_message = "Réponse Ollama illisible (JSON invalide)"
        print(f"❌ {error_message}: {exc}")
        return None, error_message
    text = data.get('response', '')

    print(f"\n🔍 DEBUG Ollama response: {text[:200]}")

    text = text.strip()

    if '```json' in text:
        text = text.split('```json')[1].split('```')[0].strip()
    elif '```' in text:
        text = text.split('```')[1].split('```')[0].strip()

    start = text.find('{')
    end = text.rfind('}') + 1

    if start != -1 and end > start:
        json_str = text[start:end]
        print(f"🔍 JSON extrait: {json_str}")

        result, decode_error = _load_json_loose(json_str)

        if decode_error:
            error_message = f"Réponse Ollama JSON invalide: {decode_error}"
            print(f"❌ {error_message}")
            return None, error_message

        if 'can_delete' in result and 'reason' in result:
            return result, None

        error_message = f"JSON invalide (champs manquants): {result}"
        print(f"❌ {error_message}")
        return None, error_message

    error_message = f"Réponse Ollama sans JSON exploitable: {text[:120]}"
    print(f"❌ {error_message}")
    return None, error_message

def analyze_file(file_info, model="llama3:8b"):
    """Analyse un fichier"""

    protected, keyword = is_protected(file_info['name'])
    if protected:
        return {
            'importance': 'high',
            'can_delete': False,
            'reason': f'🛡️ Document protégé ({keyword})'
        }

    preview = extract_text_preview(file_info)
    preview_length = len(preview) if preview else 0
    print(f"📝 Preview length for {file_info['name']}: {preview_length}")

    critical_reason = detect_critical_content(preview)

    if critical_reason:
        return {
            'importance': 'high',
            'can_delete': False,
            'reason': f'🔒 {critical_reason}'
        }

    local_decision = apply_local_rules(file_info, preview)

    if local_decision:
        return local_decision

    parent_folder, neighbor_files = _list_neighbor_files(file_info)
    neighbor_excerpt = ', '.join(neighbor_files) if neighbor_files else 'No close neighbors listed.'

    if preview:
        preview_section = f"File preview (first lines, sanitized):\n{preview}\n"
    else:
        preview_section = (
            "No textual preview is available (likely binary/image/archive)."
            " Use metadata hints (filename patterns, extension, age, size,"
            " category, parent folder, and nearby filenames) to decide."
            " If metadata clearly shows temporary/log/screenshot/test content you may delete;"
            " otherwise stay cautious.\n"
        )

    prompt = f"""You are a careful digital archivist. Decide if the file can be deleted.

INPUT METADATA (use this when the preview gives little signal):
- File name: {file_info['name']}
- Extension: {file_info['ext']}
- Size: {human_size(file_info['size'])}
- Age: {file_info['age']} days
- Category: {file_info['category']}
- Preview length: {preview_length} characters
- Parent folder: {parent_folder}
- Neighbor files: {neighbor_excerpt}

TEXT PREVIEW (top priority):
{preview_section}

STRICT NON-NEGOTIABLE RULES (content outranks filenames):
1. If the preview or metadata indicates invoices, receipts, proofs of purchase, URSSAF/administrative docs, banking statements, IBAN/RIB, or payment references -> importance="high", can_delete=false. Explain which trigger fired.
2. Tickets, boarding passes, travel reservations, QR codes, concert bookings -> importance="high", can_delete=false.
3. Passwords, logins, credentials, recovery codes, OTP/2FA, or account access details -> importance="high", can_delete=false.
4. CVs, cover letters, signed contracts, attestations, certificates, identity docs, prescriptions, and medical records -> importance="high", can_delete=false.
5. Only answer "importance":"unknown" when BOTH preview and metadata fail to indicate whether the file is safe or critical. Lack of preview alone is not enough if the filename/metadata are descriptive.
6. Content > metadata > filename. Still, when the preview is absent you must reason from metadata/filename/folder neighbors instead of defaulting to unknown.
7. Screenshots (filenames containing "Capture d’écran", "Screenshot", "Screen Shot", etc.) can be deleted even if recent as long as no metadata or preview hints at sensitive content.

DELETE ONLY WHEN ALL OF THE FOLLOWING ARE TRUE:
- Content or metadata clearly points to temporary/cache/log/screenshot/test/duplicate material.
- No hints of administrative, financial, personal, or security relevance.
- You can articulate why deletion is safe.

Respond in valid JSON (no prose) using one of these forms:
{{"importance":"high","can_delete":false,"reason":"why it must be kept"}}
{{"importance":"unknown","can_delete":false,"reason":"why you are unsure"}}
{{"importance":"low","can_delete":true,"reason":"why deletion is safe"}}
"""
    
    socketio.emit('ai_thinking', {
        'file': file_info['name'],
        'prompt': prompt[:150] + '...'
    })
    
    result, error_message = call_ollama(prompt, model)

    if result:
        socketio.emit('ai_result', {
            'file': file_info['name'],
            'result': result
        })
        socketio.sleep(0)
    else:
        result = {
            'importance': 'unknown',
            'can_delete': False,
            'reason': f"⚠️ Analyse indisponible - {error_message or 'IA locale inaccessible'}"
        }
        socketio.emit('ai_result', {
            'file': file_info['name'],
            'result': result
        })
    
    return result

def analyze_batch(candidates, model="llama3:8b", batch_size=10):
    """Analyse par batch avec updates temps réel"""
    results = []

    for i, candidate in enumerate(candidates):
        if analyze_cancel_event.is_set():
            break

        analysis = analyze_file(candidate, model)

        if analysis:
            decision = 'DELETE' if analysis.get('can_delete') else 'KEEP'
            if analysis.get('importance') == 'unknown':
                decision = 'REVIEW'

            record = {
                'file': candidate['path'],
                'name': candidate['name'],
                'size': candidate['size'],
                'size_h': human_size(candidate['size']),
                'age_days': candidate['age'],
                'category': candidate['category'],
                'decision': decision,
                'reason': analysis.get('reason', 'Décision indisponible'),
                'can_delete': analysis.get('can_delete', False)
            }
            results.append(record)

            socketio.emit('analyze_progress', {
                'current': i + 1,
                'total': len(candidates),
                'file': candidate['name'],
                'decision': decision,
                'reason': record['reason']
            })

    return results

# ═══════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════

@app.route('/')
def index():
    index_path = STATIC_DIR / 'index.html'
    if index_path.exists():
        return send_file(str(index_path))
    else:
        return jsonify({
            'error': 'Frontend non trouvé',
            'solution': 'Crée le fichier static/index.html',
            'path': str(index_path)
        }), 404


@app.route('/favicon.ico')
def favicon():
    icon_path = STATIC_DIR / 'favicon.ico'
    if icon_path.exists():
        return send_from_directory(str(STATIC_DIR), 'favicon.ico')
    return '', 204

@app.route('/api/select_folder', methods=['POST'])
def api_select_folder():
    """Sélectionner un dossier côté backend (fallback Downloads)."""
    data = request.get_json(silent=True) or {}
    requested = data.get('path')

    if requested:
        target = Path(requested).expanduser()
    elif state['last_scan_path']:
        target = Path(state['last_scan_path'])
    else:
        downloads = Path.home() / 'Downloads'
        target = downloads if downloads.exists() else Path.home()

    if not target.exists() or not target.is_dir():
        return jsonify({'ok': False, 'error': f'Dossier introuvable: {target}'}), 400

    state['last_scan_path'] = str(target)
    return jsonify({'ok': True, 'path': str(target)})


@app.route('/api/scan', methods=['POST'])
def api_scan():
    """Lancer un scan"""
    if state['scanning']:
        return jsonify({'ok': False, 'error': 'Scan déjà en cours'}), 409

    data = request.get_json(silent=True) or {}
    path = data.get('path') or state['last_scan_path'] or str(Path.home() / "Downloads")
    scan_path = Path(path).expanduser()

    if not scan_path.exists() or not scan_path.is_dir():
        return jsonify({'ok': False, 'error': f'Dossier introuvable: {scan_path}'}), 400

    try:
        min_age = max(0, int(data.get('min_age_days', 30)))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'min_age_days invalide'}), 400

    try:
        min_size = max(0, float(data.get('min_size_mb', 20)))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'min_size_mb invalide'}), 400
    requested_categories = data.get('categories') or []

    allowed_categories = None
    if requested_categories:
        allowed_categories = set()
        valid_categories = set(CATEGORIES.keys()) | {'Autres'}
        for category in requested_categories:
            if category not in valid_categories:
                return jsonify({'ok': False, 'error': f'Catégorie inconnue: {category}'}), 400
            allowed_categories.add(category)

        if not allowed_categories:
            return jsonify({'ok': False, 'error': 'Aucune catégorie valide sélectionnée'}), 400

    state['last_scan_path'] = str(scan_path)

    def scan_task():
        scan_cancel_event.clear()
        state['scanning'] = True
        socketio.emit('scan_started', {'path': str(scan_path)})

        try:
            result = scan_directory(
                str(scan_path),
                min_age,
                min_size,
                cancel_event=scan_cancel_event,
                allowed_categories=allowed_categories
            )
        except Exception as exc:  # pragma: no cover - log unexpected errors
            state['scanning'] = False
            socketio.emit('scan_error', {
                'error': str(exc),
                'path': str(scan_path)
            })
            scan_cancel_event.clear()
            return

        files_payload = [
            {
                'file': candidate['path'],
                'name': candidate['name'],
                'size': candidate['size'],
                'size_h': human_size(candidate['size']),
                'age_days': candidate['age'],
                'category': candidate['category']
            }
            for candidate in result['candidates']
        ]

        protected_payload = [
            {
                'file': entry['path'],
                'name': entry['name'],
                'size': entry['size'],
                'size_h': human_size(entry['size']),
                'age_days': entry['age'],
                'category': entry['category'],
                'keyword': entry['keyword']
            }
            for entry in result['protected']
        ]

        stats_payload = {
            k: {
                'count': v['count'],
                'size_h': human_size(v['size'])
            }
            for k, v in result['stats'].items()
        }

        state['total_files'] = result['total_files']
        state['stats'] = stats_payload
        state['candidates'] = result['candidates']
        state['files'] = files_payload
        state['protected_files'] = protected_payload
        state['scanning'] = False

        event_name = 'scan_cancelled' if scan_cancel_event.is_set() else 'scan_finished'
        payload = {
            'count': len(files_payload),
            'total_files': result['total_files'],
            'files': files_payload,
            'stats': stats_payload,
            'path': str(scan_path),
            'protected': protected_payload,
            'cancelled': event_name == 'scan_cancelled',
            'selected_categories': sorted(allowed_categories) if allowed_categories else None
        }
        socketio.emit(event_name, payload)
        socketio.emit('scan_complete', payload)  # compat frontend legacy
        scan_cancel_event.clear()

    thread = threading.Thread(target=scan_task)
    thread.start()

    return jsonify({'ok': True, 'status': 'started'})

@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    """Lancer l'analyse IA"""
    if state['analyzing']:
        return jsonify({'ok': False, 'error': 'Analyse déjà en cours'}), 409

    data = request.get_json(silent=True) or {}
    model = data.get('model', 'llama3:8b')
    max_files = data.get('max_files')

    requested_files = data.get('paths') or []
    candidate_map = {c['path']: c for c in state['candidates']}
    selected = []

    if requested_files:
        for entry in requested_files:
            if isinstance(entry, str):
                path = entry
            elif isinstance(entry, dict):
                path = entry.get('file') or entry.get('path')
            else:
                continue

            candidate = candidate_map.get(path)
            if candidate:
                selected.append(candidate)

    if not selected:
        limit = len(state['candidates'])
        if max_files is not None:
            limit = min(limit, int(max_files))
        selected = state['candidates'][:limit]

    if not selected:
        return jsonify({'ok': False, 'error': 'Aucun fichier à analyser'}), 400

    try:
        ensure_ollama_ready(model)
    except RuntimeError as exc:
        message = str(exc)
        socketio.emit('analyze_error', {'error': message})
        return jsonify({'ok': False, 'error': message}), 503

    def analyze_task():
        analyze_cancel_event.clear()
        state['analyzing'] = True
        socketio.emit('analyze_started', {'total': len(selected)})

        try:
            results = analyze_batch(selected, model)
        except Exception as exc:  # pragma: no cover - log unexpected errors
            state['analyzing'] = False
            socketio.emit('analyze_error', {'error': str(exc)})
            analyze_cancel_event.clear()
            return

        state['results'] = results
        state['analyzing'] = False

        decisions = {'DELETE': 0, 'KEEP': 0, 'REVIEW': 0}
        total_deletable = 0

        for result in results:
            decision = result.get('decision', 'REVIEW')
            decisions[decision] = decisions.get(decision, 0) + 1
            if decision == 'DELETE':
                total_deletable += result.get('size', 0)

        payload = {
            'results': results,
            'total': len(results),
            'counts': decisions,
            'space_recoverable': human_size(total_deletable),
            'cancelled': analyze_cancel_event.is_set()
        }

        socketio.emit('analyze_complete', payload)
        analyze_cancel_event.clear()

    thread = threading.Thread(target=analyze_task)
    thread.start()

    return jsonify({'ok': True, 'status': 'started', 'count': len(selected)})

@app.route('/api/results', methods=['GET'])
def api_results():
    """Obtenir les résultats"""
    return jsonify({
        'ok': True,
        'results': state['results'],
        'stats': state['stats'],
        'files': state['files'],
        'protected': state['protected_files']
    })


@app.route('/api/ai_status', methods=['GET'])
def api_ai_status():
    """Vérifie la configuration locale d'Ollama pour l'IA."""
    model = request.args.get('model', 'llama3:8b')

    try:
        ensure_ollama_ready(model)
    except RuntimeError as exc:
        return jsonify({
            'ok': False,
            'model': model,
            'ollama_url': OLLAMA_URL,
            'error': str(exc)
        }), 503

    return jsonify({
        'ok': True,
        'model': model,
        'ollama_url': OLLAMA_URL
    })

@app.route('/api/delete_by_category', methods=['POST'])
def api_delete_by_category():
    """Supprimer tous les fichiers des catégories sélectionnées"""
    data = request.get_json(silent=True) or {}
    categories = data.get('categories', [])

    if not categories:
        return jsonify({'ok': False, 'error': 'Aucune catégorie sélectionnée'}), 400
    
    deleted = []
    errors = []
    total_size = 0
    
    for candidate in state['candidates']:
        if candidate['category'] in categories:
            protected, keyword = is_protected(candidate['name'])
            if protected:
                errors.append({
                    'path': candidate['path'],
                    'error': f'🛡️ PROTÉGÉ ({keyword})'
                })
                continue
            
            try:
                os.unlink(candidate['path'])
                deleted.append(candidate['path'])
                total_size += candidate['size']
                socketio.emit('file_deleted', {'path': candidate['path']})
            except Exception as e:
                errors.append({'path': candidate['path'], 'error': str(e)})
    
    return jsonify({
        'deleted': len(deleted),
        'errors': len(errors),
        'size_freed': total_size,
        'size_freed_h': human_size(total_size),
        'details': {'deleted': deleted, 'errors': errors},
        'ok': True
    })

@app.route('/api/delete', methods=['POST'])
def api_delete():
    """Supprimer les fichiers sélectionnés"""
    data = request.get_json(silent=True) or {}
    file_paths = data.get('files', [])

    deleted = []
    errors = []
    total_size = 0

    for path in file_paths:
        try:
            filename = os.path.basename(path)
            protected, keyword = is_protected(filename)
            
            if protected:
                errors.append({
                    'path': path,
                    'error': f'🛡️ REFUSÉ: Document protégé (mot-clé: {keyword})'
                })
                print(f"🛡️ SUPPRESSION REFUSÉE: {filename} (protégé: {keyword})")
                continue
            
            try:
                file_size = os.path.getsize(path)
            except OSError:
                file_size = 0

            os.unlink(path)
            deleted.append(path)
            total_size += file_size
            socketio.emit('file_deleted', {'path': path})
            print(f"✅ Supprimé: {filename}")
        except Exception as e:
            errors.append({'path': path, 'error': str(e)})
            socketio.emit('file_delete_error', {'path': path, 'error': str(e)})

    return jsonify({
        'deleted': len(deleted),
        'errors': len(errors),
        'size_freed': total_size,
        'size_freed_h': human_size(total_size),
        'details': {'deleted': deleted, 'errors': errors},
        'ok': True
    })

@app.route('/api/status', methods=['GET'])
def api_status():
    """État actuel"""
    return jsonify({
        'ok': True,
        'scanning': state['scanning'],
        'analyzing': state['analyzing'],
        'total_files': state['total_files'],
        'candidates': len(state['candidates']),
        'results': len(state['results'])
    })


@app.route('/api/stop', methods=['POST'])
def api_stop():
    """Arrêter scan/analyse en cours"""
    scan_cancel_event.set()
    analyze_cancel_event.set()
    state['scanning'] = False
    state['analyzing'] = False
    return jsonify({'ok': True, 'message': 'Arrêt demandé'})

# ═══════════════════════════════════════════════════════════
# WEBSOCKET EVENTS
# ═══════════════════════════════════════════════════════════

@socketio.on('connect')
def handle_connect():
    print('Client connecté')
    emit('connected', {'status': 'ok'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client déconnecté')

if __name__ == '__main__':
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║     🌐 AI CLEANER WEBAPP - Backend Flask                    ║
║     Python {sys.version.split()[0]} - Compatible 3.14       ║
╚══════════════════════════════════════════════════════════════╝

🚀 Serveur lancé sur http://localhost:5000
📡 WebSocket activé pour updates temps réel
    """)
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
