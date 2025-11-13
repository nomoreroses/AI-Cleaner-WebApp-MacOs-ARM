#!/usr/bin/env python3
"""
Flask Backend pour AI Cleaner WebApp - Compatible Python 3.14
API + WebSocket pour updates temps réel
"""

# PATCH pour Python 3.14 : Restaurer pkgutil.get_loader
import pkgutil
import sys
if not hasattr(pkgutil, 'get_loader'):
    import importlib.util
    def _get_loader(name):
        try:
            spec = importlib.util.find_spec(name)
        except (ValueError, ImportError):
            # Python 3.14 peut lever ValueError si __spec__ est None (ex: __main__)
            # ou ImportError si le module n'existe pas. Dans ces cas, on renvoie None
            # pour imiter l'ancien comportement de pkgutil.get_loader.
            return None
        return spec.loader if spec else None
    pkgutil.get_loader = _get_loader

from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import os
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

# État global
state = {
    'scanning': False,
    'analyzing': False,
    'total_files': 0,
    'scanned_files': 0,
    'analyzed_files': 0,
    'candidates': [],
    'results': [],
    'stats': {}
}

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

CATEGORIES = {
    'Images': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic'},
    'Videos': {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv'},
    'Audio': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'},
    'Documents': {'.pdf', '.doc', '.docx', '.txt', '.rtf', '.pages'},
    'Archives': {'.zip', '.rar', '.7z', '.tar', '.gz', '.dmg'},
    'Code': {'.py', '.js', '.html', '.css', '.java', '.cpp', '.sh'},
    'Installers': {'.pkg', '.dmg', '.app', '.exe'},
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

def is_protected(filename):
    """Vérifie si un fichier contient un mot-clé protégé"""
    name_lower = filename.lower()
    for keyword in PROTECTED_KEYWORDS:
        if keyword in name_lower:
            return True, keyword
    return False, None

def scan_directory(path, min_age_days=30, min_size_mb=20):
    """Scan rapide avec os.scandir"""
    stats = defaultdict(lambda: {'count': 0, 'size': 0})
    candidates = []
    total = 0
    
    def scan_recursive(dir_path):
        nonlocal total
        try:
            with os.scandir(dir_path) as entries:
                for entry in entries:
                    if entry.name.startswith('.'):
                        continue
                    
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name in IGNORED_DIRS:
                            continue
                        scan_recursive(entry.path)
                    
                    elif entry.is_file(follow_symlinks=False):
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
                            
                            stats[category]['count'] += 1
                            stats[category]['size'] += size
                            
                            # 🛡️ PROTECTION: Ne pas ajouter si mot-clé protégé
                            protected, keyword = is_protected(entry.name)
                            if protected:
                                print(f"🛡️ PROTÉGÉ: {entry.name} (mot-clé: {keyword})")
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
        'candidates': sorted(candidates, key=lambda x: x['age'], reverse=True)
    }

def call_ollama(prompt, model="llama3:8b"):
    """Appel Ollama optimisé"""
    try:
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
        
        resp = session.post("http://localhost:11434/api/generate", json=payload, timeout=20)
        
        if resp.status_code == 200:
            data = resp.json()
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
                
                result = json.loads(json_str)
                
                if 'can_delete' in result and 'reason' in result:
                    return result
                else:
                    print(f"❌ JSON invalide (champs manquants): {result}")
            else:
                print(f"❌ Pas de JSON trouvé dans: {text}")
        else:
            print(f"❌ Erreur HTTP {resp.status_code}")
            
        return None
    except Exception as e:
        print(f"❌ Exception: {e}")
        return None

def analyze_file(file_info, model="llama3:8b"):
    """Analyse un fichier"""
    
    protected, keyword = is_protected(file_info['name'])
    if protected:
        return {
            'importance': 'high',
            'can_delete': False,
            'reason': f'🛡️ Document protégé ({keyword})'
        }
    
    prompt = f"""Analyse ce fichier pour décider s'il peut être supprimé.

Fichier: {file_info['name']}
Type: {file_info['ext']}
Taille: {human_size(file_info['size'])}
Âge: {file_info['age']} jours

RÈGLES STRICTES - TOUJOURS GARDER:
- Documents médicaux (suivi, ordonnance, analyse, résultat)
- Factures, reçus, tickets, billets
- CV, lettres de motivation
- Documents importants, urgents, confidentiels
- Documents récents (< 60 jours)

SUPPRIMER UNIQUEMENT:
- Screenshots évidents (nom contient "screenshot", "capture")
- Fichiers temporaires (.tmp, "temp" dans le nom)
- Très anciens fichiers sans valeur (> 365 jours)

SI DOUTE → GARDER

Réponds UNIQUEMENT avec ce JSON exact:
{{"importance":"high","can_delete":false,"reason":"Raison courte"}}

ou

{{"importance":"low","can_delete":true,"reason":"Raison courte"}}"""
    
    socketio.emit('ai_thinking', {
        'file': file_info['name'],
        'prompt': prompt[:150] + '...'
    })
    
    result = call_ollama(prompt, model)
    
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
            'reason': '⚠️ Analyse échouée - CONSERVÉ par sécurité'
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
        socketio.emit('analyze_progress', {
            'current': i + 1,
            'total': len(candidates),
            'file': candidate['name']
        })
        
        analysis = analyze_file(candidate, model)
        
        if analysis:
            results.append({
                'file': candidate,
                'analysis': analysis
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

@app.route('/api/scan', methods=['POST'])
def api_scan():
    """Lancer un scan"""
    data = request.json
    path = data.get('path', str(Path.home() / "Downloads"))
    min_age = data.get('min_age_days', 30)
    min_size = data.get('min_size_mb', 20)
    
    def scan_task():
        state['scanning'] = True
        socketio.emit('scan_started', {'path': path})
        
        result = scan_directory(path, min_age, min_size)
        
        state['total_files'] = result['total_files']
        state['stats'] = result['stats']
        state['candidates'] = result['candidates']
        state['scanning'] = False
        
        socketio.emit('scan_complete', {
            'total_files': result['total_files'],
            'candidates': len(result['candidates']),
            'stats': {k: {'count': v['count'], 'size': human_size(v['size'])} 
                     for k, v in result['stats'].items()}
        })
    
    thread = threading.Thread(target=scan_task)
    thread.start()
    
    return jsonify({'status': 'started'})

@app.route('/api/analyze', methods=['POST'])
def api_analyze():
    """Lancer l'analyse IA"""
    data = request.json
    model = data.get('model', 'llama3:8b')
    max_files = data.get('max_files', len(state['candidates']))
    
    candidates = state['candidates'][:max_files]
    
    def analyze_task():
        state['analyzing'] = True
        socketio.emit('analyze_started', {'total': len(candidates)})
        
        results = analyze_batch(candidates, model)
        
        state['results'] = results
        state['analyzing'] = False
        
        can_delete = [r for r in results if r['analysis'].get('can_delete')]
        should_keep = [r for r in results if not r['analysis'].get('can_delete')]
        
        total_deletable = sum(r['file']['size'] for r in can_delete)
        
        socketio.emit('analyze_complete', {
            'total_analyzed': len(results),
            'can_delete': len(can_delete),
            'should_keep': len(should_keep),
            'space_recoverable': human_size(total_deletable)
        })
    
    thread = threading.Thread(target=analyze_task)
    thread.start()
    
    return jsonify({'status': 'started'})

@app.route('/api/results', methods=['GET'])
def api_results():
    """Obtenir les résultats"""
    return jsonify({
        'results': state['results'],
        'stats': state['stats']
    })

@app.route('/api/delete_by_category', methods=['POST'])
def api_delete_by_category():
    """Supprimer tous les fichiers des catégories sélectionnées"""
    data = request.json
    categories = data.get('categories', [])
    
    if not categories:
        return jsonify({'error': 'Aucune catégorie sélectionnée'}), 400
    
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
        'size_freed': human_size(total_size),
        'details': {'deleted': deleted, 'errors': errors}
    })

@app.route('/api/delete', methods=['POST'])
def api_delete():
    """Supprimer les fichiers sélectionnés"""
    data = request.json
    file_paths = data.get('files', [])
    
    deleted = []
    errors = []
    
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
            
            os.unlink(path)
            deleted.append(path)
            socketio.emit('file_deleted', {'path': path})
            print(f"✅ Supprimé: {filename}")
        except Exception as e:
            errors.append({'path': path, 'error': str(e)})
            socketio.emit('file_delete_error', {'path': path, 'error': str(e)})
    
    return jsonify({
        'deleted': len(deleted),
        'errors': len(errors),
        'details': {'deleted': deleted, 'errors': errors}
    })

@app.route('/api/status', methods=['GET'])
def api_status():
    """État actuel"""
    return jsonify({
        'scanning': state['scanning'],
        'analyzing': state['analyzing'],
        'total_files': state['total_files'],
        'candidates': len(state['candidates']),
        'results': len(state['results'])
    })

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
