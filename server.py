#!/usr/bin/env python3
"""
AI Cleaner WebApp - Flask Backend avec Ollama

Application de nettoyage intelligent de fichiers avec analyse IA.
Scanne des répertoires, détecte les fichiers inutiles et les supprime
en utilisant les modèles locaux Ollama pour l'analyse.

Dépendances:
    - flask, flask-cors, flask-socketio
    - requests, PyPDF2 (optionnel)
    - ollama (service externe)

Usage:
    python server.py
"""

from __future__ import annotations

import os
import sys
import unicodedata
import subprocess
import time
import shutil

from typing import Dict, List, Optional, Tuple
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import threading
import json

# --- PDF Libs (Optional) avec meilleure gestion d'erreurs ---
try:
    from PyPDF2 import PdfReader
    PDF_AVAILABLE = True
except Exception as e:
    print(f"⚠️ PyPDF2 non disponible: {e}")
    PdfReader = None
    PDF_AVAILABLE = False

import requests
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# ============================================================================
# CONFIG & CONSTANTES
# ============================================================================

IGNORED_DIRS = {
    'node_modules', '.git', '.venv', 'venv', '__pycache__',
    'Library', 'VirtualBox VMs', 'Parallels', 'Steam',
    '.Trash', '.cache', '.npm', 'Applications', 'System'
}
SKIP_EXTS = {'.DS_Store', '.localized', '.tmp', '.cache', '.log'}

# Ollama Settings - Configuration améliorée
OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://localhost:11434').rstrip('/')
OLLAMA_TIMEOUT = 30  # Timeout augmenté
OLLAMA_ENABLED = True  # Peut être désactivé

def _ollama_endpoint(path: str) -> str:
    if not path.startswith('/'):
        path = '/' + path
    return f"{OLLAMA_URL}{path}"

# Mots-clés et Catégories
ALWAYS_KEEP_KEYWORDS = [
    'ordonnance', 'compte-rendu', 'analyse', 'facture', 'invoice', 'rib', 'iban',
    'certificat', 'contrat', 'diplôme', 'cv', 'mot de passe', 'password', 'billet',
    'ticket', 'réservation', 'cni', 'passeport', 'permis', 'bulletin de salaire',
    'important', 'urgent', 'confidentiel', 'souvenir', 'vacances', 'famille'
]
PROTECTED_KEYWORDS = sorted(set(ALWAYS_KEEP_KEYWORDS))

CATEGORIES = {
    'Images': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.svg'},
    'Videos': {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'},
    'Audio': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'},
    'Documents': {'.pdf', '.doc', '.docx', '.txt', '.rtf', '.pages', '.odt', '.xls', '.xlsx', '.csv'},
    'Archives': {'.zip', '.rar', '.7z', '.tar', '.gz', '.dmg', '.iso'},
    'Code': {'.py', '.js', '.html', '.css', '.java', '.cpp', '.json', '.xml'},
    'Installers': {'.pkg', '.dmg', '.app', '.exe', '.msi', '.deb', '.rpm'},
}

# Fichiers Temporaires et Doublons
TEMPORARY_FILE_HINTS = ['tmp', 'temp', 'untitled', 'copy', 'copie', 'test', 'draft']
SCREENSHOT_PATTERNS = ['capture d\'ecran', 'capture d ecran', 'screen shot', 'screenshot', 'screencap']

# ============================================================================
# Flask Setup - Configuration robuste
# ============================================================================

SCRIPT_DIR = Path(__file__).parent
STATIC_DIR = SCRIPT_DIR / 'static'
STATIC_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path='/static')
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', os.urandom(24).hex())
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

CORS(app)

# Configuration SocketIO robuste
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    ping_timeout=60, 
    ping_interval=25,
    async_mode='threading',
    logger=False,
    engineio_logger=False,
    max_http_buffer_size=10 * 1024 * 1024  # 10MB
)

# Session HTTP avec timeout
session = requests.Session()
session.timeout = 10

# Global State
state = {
    'scanning': False,
    'analyzing': False,
    'total_files': 0,
    'scanned_files': 0,
    'analyzed_files': 0,
    'candidates': [],
    'results': [],
    'stats': {},
    'protected_files': [],
    'last_scan_path': None,
    'ollama_available': False
}
scan_cancel_event = threading.Event()
analyze_cancel_event = threading.Event()

# ============================================================================
# Fonctions Utilitaires - Version robuste
# ============================================================================

def human_size(size: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0: return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}TB"

def get_category(ext: str) -> str:
    for cat, exts in CATEGORIES.items():
        if ext.lower() in exts: return cat
    return 'Autres'

def _normalize(text: str) -> str:
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii').casefold()

def is_protected(filename: str) -> Tuple[bool, Optional[str]]:
    normalized = _normalize(filename)
    for k in PROTECTED_KEYWORDS:
        if _normalize(k) in normalized: return True, k
    return False, None

def _looks_like_screenshot(name: str) -> bool:
    normalized_name = _normalize(name)
    return any(p in normalized_name for p in SCREENSHOT_PATTERNS)

def extract_text_preview(path: str, ext: str) -> Optional[str]:
    """Extrait le texte des fichiers avec gestion robuste des erreurs"""
    try:
        # Fichiers texte simples
        if ext in {'.txt', '.md', '.json', '.csv', '.log'}:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read(600)
        
        # PDF avec gestion d'erreurs renforcée
        if ext == '.pdf' and PDF_AVAILABLE:
            try:
                reader = PdfReader(path)
                text_parts = []
                for i, page in enumerate(reader.pages[:2]):  # Maximum 2 pages
                    try:
                        text = page.extract_text()
                        if text and text.strip():
                            text_parts.append(text.strip())
                    except Exception as page_error:
                        print(f"⚠️ Erreur page PDF {i+1} dans {path}: {page_error}")
                        continue
                
                if text_parts:
                    return " ".join(text_parts)[:600]
                return None
                
            except Exception as pdf_error:
                print(f"⚠️ Erreur PDF {path}: {pdf_error}")
                return None
                
    except Exception as e:
        print(f"⚠️ Erreur lecture fichier {path}: {e}")
    
    return None

def apply_local_rules(file_info: Dict, preview: Optional[str]) -> Optional[Dict]:
    """Règles locales pour décision automatique"""
    name = file_info.get('name', '')
    age = file_info.get('age', 0)
    ext = file_info.get('ext', '').lower()
    size = file_info.get('size', 0)
    normalized_name = _normalize(name)
    
    # Captures d'écran
    if _looks_like_screenshot(name):
        return { 'importance': 'low', 'can_delete': True, 'reason': 'Capture d\'écran détectée' }
    
    # Fichiers temporaires anciens
    if any(_normalize(hint) in normalized_name for hint in TEMPORARY_FILE_HINTS) and age >= 30:
        return { 'importance': 'low', 'can_delete': True, 'reason': 'Fichier temporaire/test (+30 jours)' }

    # Fichiers protégés
    is_protected_flag, keyword = is_protected(name)
    if is_protected_flag:
        return {'importance': 'high', 'can_delete': False, 'reason': f'Mot-clé protégé: "{keyword}"'}
        
    # Gros fichiers binaires sans aperçu
    if not preview and size > 50 * 1024 * 1024:
        return {'importance': 'unknown', 'can_delete': False, 'reason': 'Gros fichier binaire (>50MB) - Revue manuelle requise'}
    
    return None

def check_ollama_availability() -> bool:
    """Vérifie si Ollama est disponible"""
    try:
        resp = session.get(_ollama_endpoint('/api/tags'), timeout=5)
        if resp.status_code == 200:
            print("✅ Ollama est disponible")
            return True
    except Exception as e:
        print(f"❌ Ollama non disponible: {e}")
    return False

def call_ollama(prompt: str, model: str = "llama3:8b") -> Tuple[Optional[dict], Optional[str]]:
    """Appel Ollama avec gestion d'erreurs complète"""
    if not OLLAMA_ENABLED:
        return None, "Ollama désactivé"
    
    try:
        # Test de connexion d'abord
        if not check_ollama_availability():
            return None, "Ollama non disponible - Démarrez le service Ollama"
        
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1, 
                "num_predict": 150,
                "top_k": 40
            }
        }
        
        print(f"🔍 Envoi requête Ollama pour modèle: {model}")
        resp = session.post(
            _ollama_endpoint('/api/generate'), 
            json=payload, 
            timeout=OLLAMA_TIMEOUT
        )
        
        if resp.status_code != 200:
            return None, f"Erreur HTTP {resp.status_code}: {resp.text}"
        
        data = resp.json()
        text = data.get('response', '').strip()
        
        if not text:
            return None, "Réponse vide d'Ollama"
        
        # Nettoyage de la réponse
        if '```json' in text:
            text = text.split('```json')[1].split('```')[0].strip()
        elif '```' in text:
            text = text.split('```')[1].split('```')[0].strip()
        
        # Extraction JSON
        try:
            result = json.loads(text)
            return result, None
        except json.JSONDecodeError:
            # Tentative d'extraction manuelle
            import re
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                try:
                    result = json.loads(json_match.group())
                    return result, None
                except:
                    pass
            
            return None, f"Réponse JSON invalide: {text[:100]}..."
            
    except requests.exceptions.Timeout:
        return None, f"Timeout après {OLLAMA_TIMEOUT}s - Ollama trop lent"
    except requests.exceptions.ConnectionError:
        return None, "Impossible de se connecter à Ollama - Service démarré ?"
    except Exception as e:
        return None, f"Erreur Ollama: {str(e)}"

def analyze_file_with_fallback(file_info: Dict, model: str) -> Dict:
    """Analyse de fichier avec fallback vers règles locales"""
    name = file_info['name']
    path = file_info['path']
    ext = file_info['ext']
    
    # Extraction du preview
    preview = extract_text_preview(path, ext)
    
    # Règles locales d'abord
    local_decision = apply_local_rules(file_info, preview)
    if local_decision:
        return local_decision

    # Si Ollama n'est pas disponible, utiliser des règles étendues
    if not check_ollama_availability():
        return {
            'importance': 'unknown',
            'can_delete': False,
            'reason': 'Ollama indisponible - Utilisez les règles automatiques'
        }

    # Préparation du prompt pour Ollama
    parent_folder = Path(path).parent.name
    preview_section = f"Aperçu:\n{preview}\n" if preview else "Aperçu: Aucun (fichier binaire probable)"
    
    prompt = f"""
Analyse ce fichier pour le nettoyage. Réponds UNIQUEMENT avec un objet JSON.

Métadonnées:
- Nom: {name}
- Âge: {file_info['age']} jours  
- Taille: {human_size(file_info['size'])}
- Catégorie: {file_info['category']}
- Dossier parent: {parent_folder}

{preview_section}

Règles:
- SUPPRIMER: installers, fichiers temporaires, doublons, captures d'écran aléatoires, brouillons anciens
- GARDER: documents personnels, légaux, financiers, fichiers de travail importants

Réponse JSON uniquement:
{{ 
  "can_delete": true/false,
  "reason": "explication courte",
  "importance": "low"/"medium"/"high"
}}
"""

    socketio.emit('ai_thinking', {'file': name})
    
    result, error_message = call_ollama(prompt, model)
    
    if result:
        socketio.emit('ai_result', {'file': name, 'result': result})
        return result
    else:
        # Fallback vers règles automatiques en cas d'erreur Ollama
        fallback_reason = f"IA indisponible - {error_message}"
        
        # Règles automatiques basées sur l'extension et l'âge
        if ext in {'.tmp', '.temp', '.log'} and file_info['age'] > 30:
            decision = {'importance': 'low', 'can_delete': True, 'reason': 'Fichier temporaire ancien'}
        elif ext in {'.dmg', '.pkg', '.exe', '.msi'} and file_info['age'] > 90:
            decision = {'importance': 'medium', 'can_delete': True, 'reason': 'Installeur ancien'}
        else:
            decision = {'importance': 'unknown', 'can_delete': False, 'reason': fallback_reason}
        
        socketio.emit('ai_result', {'file': name, 'result': decision})
        return decision

def scan_directory(path, min_age, min_size, cancel_event, allowed_categories):
    """Scan de répertoire avec gestion d'erreurs améliorée"""
    candidates = []
    protected_files = []
    stats = defaultdict(int)
    total = 0
    min_size_bytes = min_size * 1024 * 1024

    try:
        for root, dirs, files in os.walk(path):
            if cancel_event.is_set(): 
                break
            
            # Filtrage des dossiers ignorés
            dirs[:] = [d for d in dirs if d.lower() not in IGNORED_DIRS]

            for name in files:
                if cancel_event.is_set(): 
                    break
                
                total += 1
                file_path = Path(root) / name
                
                ext = file_path.suffix.lower()
                if ext in SKIP_EXTS: 
                    continue

                try:
                    stat = file_path.stat()
                    size = stat.st_size
                    mtime = stat.st_mtime
                    age_days = (datetime.now() - datetime.fromtimestamp(mtime)).days
                    category = get_category(ext)
                    
                    is_protected_flag, keyword = is_protected(name)
                    
                    file_info = {
                        'path': str(file_path),
                        'name': name,
                        'size': size,
                        'age': age_days,
                        'ext': ext,
                        'category': category
                    }
                    
                    if is_protected_flag:
                        protected_files.append(file_info)
                        socketio.emit('log', {'msg': f'🛡️ Protégé: {name} ({keyword})', 'type': 'info'})
                    elif size >= min_size_bytes and age_days >= min_age and category in allowed_categories:
                        candidates.append(file_info)

                    stats[category] += 1

                    # Mise à jour de progression
                    if total % 50 == 0:
                        socketio.emit('scan_update', {
                            'total_files': total,
                            'candidates_count': len(candidates),
                            'stats': dict(stats)
                        })
                        
                except Exception as e:
                    socketio.emit('log', {'msg': f'❌ Erreur {name}: {e}', 'type': 'warn'})
                    continue
                    
    except Exception as e:
        socketio.emit('log', {'msg': f'❌ Erreur scan répertoire: {e}', 'type': 'error'})
        raise
    
    return {
        'total_files': total,
        'stats': dict(stats),
        'candidates': candidates,
        'protected': protected_files
    }

def analyze_batch(candidates, model="llama3:8b"):
    """Analyse par lot avec gestion d'erreurs"""
    results = []
    
    # Vérification Ollama au début
    ollama_ok = check_ollama_availability()
    if not ollama_ok:
        socketio.emit('log', {'msg': '⚠️ Ollama non disponible - Utilisation des règles automatiques', 'type': 'warn'})
    
    for i, candidate in enumerate(candidates):
        if analyze_cancel_event.is_set():
            break
        
        try:
            analysis = analyze_file_with_fallback(candidate, model)
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
                    'reason': analysis.get('reason', 'N/A'),
                    'importance': analysis.get('importance', 'unknown')
                }
                results.append(record)
                
                state['analyzed_files'] = i + 1
                socketio.emit('analyze_update', {
                    'analyzed_files': state['analyzed_files'],
                    'total_candidates': len(candidates),
                    'current_file': candidate['name']
                })
                
        except Exception as e:
            socketio.emit('log', {'msg': f'❌ Erreur analyse {candidate["name"]}: {e}', 'type': 'error'})
            continue
    
    return results

def remove_empty_folders(path):
    """Supprime les dossiers vides"""
    deleted_count = 0
    if not os.path.isdir(path): 
        return 0
    
    try:
        for root, dirs, files in os.walk(path, topdown=False):
            for name in dirs:
                try:
                    folder_path = os.path.join(root, name)
                    if not os.listdir(folder_path):
                        os.rmdir(folder_path)
                        deleted_count += 1
                except Exception:
                    continue
    except Exception as e:
        print(f"Erreur nettoyage dossiers: {e}")
        
    return deleted_count

def run_native_picker() -> Optional[str]:
    """Sélecteur de dossier natif multi-plateforme"""
    try:
        if sys.platform == "darwin":
            script = """
import sys
import subprocess
try:
    from Cocoa import NSOpenPanel, NSModalResponseOK, NSApplication
    app = NSApplication.sharedApplication()
    app.activateIgnoringOtherApps_(True)
    panel = NSOpenPanel.openPanel()
    panel.setCanChooseFiles_(False)
    panel.setCanChooseDirectories_(True)
    panel.setAllowsMultipleSelection_(False)
    panel.setPrompt_("Scanner")
    if panel.runModal() == NSModalResponseOK:
        print(panel.URL().path(), end='')
        sys.exit(0)
    sys.exit(1)
except ImportError:
    cmd = ['osascript', '-e', 'activate', '-e', 'POSIX path of (choose folder with prompt "Sélectionner un dossier à scanner")']
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode == 0:
        print(result.stdout.strip(), end='')
        sys.exit(0)
    sys.exit(1)
"""
        elif sys.platform == "win32":
            script = """
import tkinter as tk
from tkinter import filedialog
import sys
root = tk.Tk()
root.withdraw()
folder_path = filedialog.askdirectory()
if folder_path:
    print(folder_path, end='')
    sys.exit(0)
sys.exit(1)
"""
        else:  # Linux
            script = """
import tkinter as tk
from tkinter import filedialog
import sys
root = tk.Tk()
root.withdraw()
folder_path = filedialog.askdirectory()
if folder_path:
    print(folder_path, end='')
    sys.exit(0)
sys.exit(1)
"""
        
        process = subprocess.run(
            [sys.executable, '-c', script],
            capture_output=True,
            text=True,
            check=False,
            timeout=15
        )
        if process.returncode == 0:
            return process.stdout.strip()
        
        return None
        
    except Exception as e:
        print(f"Erreur sélecteur natif: {e}")
        return None

# ============================================================================
# API Routes - Version robuste
# ============================================================================

@app.route('/')
def index():
    """Page principale"""
    try:
        index_path = STATIC_DIR / 'index.html'
        if index_path.exists():
            return send_file(str(index_path))
        return jsonify({'error': 'Frontend manquant'}), 404
    except Exception as e:
        return jsonify({'error': f'Erreur chargement: {e}'}), 500

@app.route('/api/health')
def api_health():
    """Endpoint de santé"""
    ollama_status = check_ollama_availability()
    return jsonify({
        'ok': True,
        'ollama_available': ollama_status,
        'pdf_support': PDF_AVAILABLE,
        'scanning': state['scanning'],
        'analyzing': state['analyzing']
    })

@app.route('/api/select_folder', methods=['POST'])
def api_select_folder():
    """Sélection de dossier"""
    try:
        selected_path = run_native_picker()

        if selected_path:
            path = str(Path(selected_path).resolve())
            if Path(path).is_dir():
                state['last_scan_path'] = path
                socketio.emit('log', {'msg': f'📁 Dossier sélectionné: {path}', 'type': 'info'})
                return jsonify({'ok': True, 'path': path})
            else:
                return jsonify({'ok': False, 'error': f'Chemin non valide: {path}'}), 400
        
        # Fallback vers Downloads
        path = state.get('last_scan_path') or str(Path.home() / "Downloads")
        return jsonify({'ok': True, 'path': path})
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Erreur sélection: {e}'}), 500

@app.route('/api/scan', methods=['POST'])
def api_scan():
    """Lancement du scan"""
    if state['scanning']:
        return jsonify({'error': 'Scan déjà en cours'}), 409
    
    try:
        data = request.get_json(silent=True) or {}
        path = data.get('path') or state['last_scan_path']
        min_age = int(data.get('min_age_days', 30))
        min_size = float(data.get('min_size_mb', 0))
        cats = set(data.get('categories') or [])
        
        if not path or not Path(path).is_dir():
            return jsonify({'ok': False, 'error': 'Dossier invalide'}), 400

        scan_path = Path(path)
        allowed_categories = set(cats) if cats else set(CATEGORIES.keys()) | {'Autres'}

        def scan_task():
            state['scanning'] = True
            state['scanned_files'] = 0
            state['total_files'] = 0
            scan_cancel_event.clear()
            
            socketio.emit('scan_started', {'path': str(scan_path)})
            socketio.emit('log', {'msg': '🔍 Démarrage du scan...', 'type': 'info'})
            
            try:
                result = scan_directory(
                    str(scan_path), min_age, min_size, 
                    cancel_event=scan_cancel_event,
                    allowed_categories=allowed_categories
                )
            except Exception as exc:
                state['scanning'] = False
                socketio.emit('scan_error', {'error': str(exc)})
                socketio.emit('log', {'msg': f'❌ Erreur scan: {exc}', 'type': 'error'})
                scan_cancel_event.clear()
                return

            # Mise à jour état global
            state.update({
                'total_files': result['total_files'],
                'candidates': result['candidates'],
                'protected_files': result['protected'],
                'stats': result['stats']
            })
            state['scanning'] = False
            
            # Préparation résultats
            payload = {
                'total_files': result['total_files'],
                'candidates_count': len(result['candidates']),
                'protected_count': len(result['protected']),
                'stats': result['stats'],
                'candidates': result['candidates'],
                'cancelled': scan_cancel_event.is_set()
            }
            
            socketio.emit('scan_complete', payload)
            socketio.emit('log', {'msg': f'✅ Scan terminé: {len(result["candidates"])} candidats', 'type': 'success'})
            scan_cancel_event.clear()

        thread = threading.Thread(target=scan_task, daemon=True)
        thread.start()
        
        return jsonify({'ok': True, 'message': 'Scan démarré'})
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Erreur démarrage scan: {e}'}), 500

@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    """Lancement analyse IA"""
    if state['analyzing']:
        return jsonify({'error': 'Analyse déjà en cours'}), 409
    
    candidates = state.get('candidates', [])
    if not candidates:
        return jsonify({'ok': False, 'error': 'Aucun candidat à analyser'}), 400
    
    try:
        data = request.get_json(silent=True) or {}
        model = data.get('model', 'llama3:8b')

        def analyze_task():
            state['analyzing'] = True
            state['analyzed_files'] = 0
            analyze_cancel_event.clear()
            
            socketio.emit('analyze_started', {'total_candidates': len(candidates), 'model': model})
            
            # Vérification Ollama
            ollama_ok = check_ollama_availability()
            if ollama_ok:
                socketio.emit('log', {'msg': f'🧠 Analyse IA démarrée ({len(candidates)} fichiers)', 'type': 'info'})
            else:
                socketio.emit('log', {'msg': '⚠️ Ollama indisponible - Règles automatiques activées', 'type': 'warn'})
            
            try:
                results = analyze_batch(candidates, model=model)
            except Exception as exc:
                state['analyzing'] = False
                socketio.emit('analyze_error', {'error': str(exc)})
                socketio.emit('log', {'msg': f'❌ Erreur analyse: {exc}', 'type': 'error'})
                analyze_cancel_event.clear()
                return
                
            state['results'] = results
            state['analyzing'] = False
            
            # Statistiques
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
            socketio.emit('log', {'msg': f'✅ Analyse terminée: {decisions["DELETE"]} à supprimer', 'type': 'success'})
            analyze_cancel_event.clear()

        thread = threading.Thread(target=analyze_task, daemon=True)
        thread.start()
        
        return jsonify({'ok': True, 'message': 'Analyse démarrée'})
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Erreur démarrage analyse: {e}'}), 500

@app.route('/api/stop', methods=['POST'])
def api_stop():
    """Arrêt des opérations"""
    try:
        if state['scanning'] or state['analyzing']:
            scan_cancel_event.set()
            analyze_cancel_event.set()
            socketio.emit('log', {'msg': '🛑 Arrêt demandé...', 'type': 'warn'})
            return jsonify({'ok': True, 'message': 'Arrêt demandé'})
        
        return jsonify({'ok': True, 'message': 'Aucune opération en cours'})
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Erreur arrêt: {e}'}), 500

@app.route('/api/delete', methods=['POST'])
def api_delete():
    """Suppression de fichiers"""
    try:
        files_to_delete = request.get_json().get('files', [])
        deleted_count = 0
        
        if not files_to_delete:
            return jsonify({'ok': False, 'message': 'Aucun fichier sélectionné'}), 400

        socketio.emit('log', {'msg': f'🗑️ Suppression de {len(files_to_delete)} fichiers...', 'type': 'info'})

        for f in files_to_delete:
            try:
                file_path = Path(f)
                if not is_protected(file_path.name)[0] and file_path.exists():
                    file_path.unlink()
                    deleted_count += 1
                    socketio.emit('file_deleted', {'path': f})
                else:
                    socketio.emit('log', {'msg': f'🛡️ Fichier protégé ou absent: {file_path.name}', 'type': 'warn'})
            except Exception as e: 
                socketio.emit('log', {'msg': f'❌ Erreur suppression {Path(f).name}: {e}', 'type': 'error'})

        # Nettoyage dossiers vides
        folders_cleaned = 0
        if state['last_scan_path']:
            folders_cleaned = remove_empty_folders(state['last_scan_path'])
            if folders_cleaned > 0:
                socketio.emit('log', {'msg': f'📁 {folders_cleaned} dossiers vides nettoyés', 'type': 'success'})

        socketio.emit('log', {'msg': f'✅ {deleted_count} fichiers supprimés', 'type': 'success'})
        
        return jsonify({'ok': True, 'deleted': deleted_count, 'folders_cleaned': folders_cleaned})
        
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Erreur suppression: {e}'}), 500

@app.route('/api/status', methods=['GET'])
def api_status():
    """Statut de l'application"""
    return jsonify({
        'ok': True,
        'scanning': state['scanning'],
        'analyzing': state['analyzing'],
        'total_files': state['total_files'],
        'candidates': len(state['candidates']),
        'results': len(state['results']),
        'ollama_available': check_ollama_availability()
    })

# ============================================================================
# WEBSOCKET EVENTS
# ============================================================================

@socketio.on('connect')
def handle_connect():
    print('✅ Client connecté')
    emit('connected', {'status': 'ok'})

@socketio.on('disconnect')
def handle_disconnect():
    print('❌ Client déconnecté')

# ============================================================================
# Lancement
# ============================================================================

if __name__ == '__main__':
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║     🌐 AI CLEANER WEBAPP - Backend Flask OLLAMA FIXED      ║
║     Python {sys.version.split()[0]} - Gestion d'erreurs     ║
╚══════════════════════════════════════════════════════════════╝

📊 Statut:
• PDF Support: {'✅' if PDF_AVAILABLE else '❌'}
• Ollama: {'✅ Connecté' if check_ollama_availability() else '❌ Non disponible'}

🚀 Serveur: http://localhost:5000
💡 Conseil: Démarrez Ollama avec 'ollama serve' si non disponible
    """)
    
    try:
        socketio.run(
            app, 
            host='0.0.0.0', 
            port=5000, 
            debug=False, 
            allow_unsafe_werkzeug=True
        )
    except Exception as e:
        print(f"❌ Erreur démarrage serveur: {e}")
        sys.exit(1)