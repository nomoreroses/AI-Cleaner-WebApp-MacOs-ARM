# AI Cleaner WebApp - Backend Flask

Nettoyage intelligent de disque dur avec analyse IA locale via Ollama.

## Fonctionnalités

- **Scan récursif** : Parcourt les répertoires et détecte les fichiers candidats à la suppression
- **Analyse IA** : Utilise Ollama (llama3:8b par défaut) pour analyser chaque fichier
- **Règles locales** : Protège les fichiers importants (documents, contrats, etc.)
- **WebSocket en temps réel** : Progression live du scan et de l'analyse
- **Fallback automatique** : Bascule sur des règles si Ollama n'est pas disponible

## Installation

### Prérequis

- Python 3.10+
- Ollama installé et disponible (`ollama serve`)
- pip

### Setup

```bash
# Cloner le repo
git clone <repo>
cd ai-cleaner-webapp

# Créer un environnement virtuel
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Installer les dépendances
pip install -r requirements.txt

# Configurer les variables d'environnement (optionnel)
cp .env.example .env
# Éditer .env selon vos besoins
```

## Lancement

```bash
# Assurez-vous qu'Ollama tourne
ollama serve

# Dans un autre terminal
python server.py
```

Le serveur démarre sur `http://localhost:5000`

## Architecture

```
server.py          # Point d'entrée principal
├── config.py      # Configuration centralisée
├── tests/
│   └── test_*.py   # Suite de tests
└── static/         # Frontend (généré)
```

## Configuration

Les variables d'environnement disponibles :

- `OLLAMA_URL` : URL du service Ollama (défaut: http://localhost:11434)
- `OLLAMA_TIMEOUT` : Timeout en secondes (défaut: 30)
- `OLLAMA_MODEL` : Modèle à utiliser (défaut: llama3:8b)
- `FLASK_PORT` : Port du serveur (défaut: 5000)
- `FLASK_HOST` : Host (défaut: 0.0.0.0)
- `SECRET_KEY` : Clé secrète Flask (générée si non définie)

## Tests

```bash
pytest tests/ -v
```

## API Endpoints

### POST `/api/scan`
Lance un scan du répertoire.

**Body:**
```json
{
  "path": "/home/user",
  "min_age": 30,
  "min_size": 10,
  "allowed_categories": ["Images", "Videos"]
}
```

### POST `/api/analyze`
Lance l'analyse IA des candidats trouvés.

**Body:**
```json
{
  "model": "llama3:8b"
}
```

### POST `/api/delete`
Supprime les fichiers sélectionnés.

**Body:**
```json
{
  "files": ["/path/to/file1", "/path/to/file2"]
}
```

### GET `/api/status`
Récupère le statut actuel de l'application.

### POST `/api/stop`
Arrête les opérations en cours.

## WebSocket Events

- `connected` : Connexion établie
- `scan_started` : Début du scan
- `scan_progress` : Progression du scan
- `scan_complete` : Fin du scan
- `analyze_started` : Début de l'analyse
- `ai_thinking` : Analyse d'un fichier
- `ai_result` : Résultat pour un fichier
- `analyze_complete` : Fin de l'analyse
- `log` : Messages de log en temps réel
- `file_deleted` : Fichier supprimé

## Troubleshooting

### Ollama non disponible
```bash
# Vérifier qu'Ollama tourne
curl http://localhost:11434/api/tags

# Démarrer Ollama
ollama serve
```

### Erreur de connexion
- Vérifier le firewall
- Vérifier OLLAMA_URL dans .env
- Vérifier les logs du serveur

## Contribution

Le code suit PEP 8. Lancer les tests avant de commit.

## License

MIT
