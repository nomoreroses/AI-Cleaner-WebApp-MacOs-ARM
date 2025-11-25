"""Configuration centralisée pour AI Cleaner"""

import os
from pathlib import Path

# Répertoires
SCRIPT_DIR = Path(__file__).parent
STATIC_DIR = SCRIPT_DIR / 'static'

# Serveur Flask
FLASK_HOST = os.getenv('FLASK_HOST', '0.0.0.0')
FLASK_PORT = int(os.getenv('FLASK_PORT', 5000))
FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB

# Ollama
OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://localhost:11434').rstrip('/')
OLLAMA_TIMEOUT = int(os.getenv('OLLAMA_TIMEOUT', 30))
OLLAMA_ENABLED = os.getenv('OLLAMA_ENABLED', 'True').lower() == 'true'
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama3:8b')

# SocketIO
SOCKETIO_PING_TIMEOUT = int(os.getenv('SOCKETIO_PING_TIMEOUT', 60))
SOCKETIO_PING_INTERVAL = int(os.getenv('SOCKETIO_PING_INTERVAL', 25))
SOCKETIO_MAX_BUFFER = 10 * 1024 * 1024  # 10MB

# Fichiers ignorés
IGNORED_DIRS = {
    'node_modules', '.git', '.venv', 'venv', '__pycache__',
    'Library', 'VirtualBox VMs', 'Parallels', 'Steam',
    '.Trash', '.cache', '.npm', 'Applications', 'System'
}

SKIP_EXTS = {'.DS_Store', '.localized', '.tmp', '.cache', '.log'}

# Mots-clés protégés
ALWAYS_KEEP_KEYWORDS = [
    'ordonnance', 'compte-rendu', 'analyse', 'facture', 'invoice', 'rib', 'iban',
    'certificat', 'contrat', 'diplôme', 'cv', 'mot de passe', 'password', 'billet',
    'ticket', 'réservation', 'cni', 'passeport', 'permis', 'bulletin de salaire',
    'important', 'urgent', 'confidentiel', 'souvenir', 'vacances', 'famille'
]

# Catégories de fichiers
CATEGORIES = {
    'Images': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.svg'},
    'Videos': {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'},
    'Audio': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'},
    'Documents': {'.pdf', '.doc', '.docx', '.txt', '.rtf', '.pages', '.odt', '.xls', '.xlsx', '.csv'},
    'Archives': {'.zip', '.rar', '.7z', '.tar', '.gz', '.dmg', '.iso'},
    'Code': {'.py', '.js', '.html', '.css', '.java', '.cpp', '.json', '.xml'},
    'Installers': {'.pkg', '.dmg', '.app', '.exe', '.msi', '.deb', '.rpm'},
}

# Détection fichiers temporaires
TEMPORARY_FILE_HINTS = ['tmp', 'temp', 'untitled', 'copy', 'copie', 'test', 'draft']
SCREENSHOT_PATTERNS = ['capture d\'ecran', 'capture d ecran', 'screen shot', 'screenshot', 'screencap']
