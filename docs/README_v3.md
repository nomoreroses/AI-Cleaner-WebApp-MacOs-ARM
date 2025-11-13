# 🤖 AI Cleaner WebApp v3.0

## 📝 Résumé du Projet

Outil intelligent de nettoyage et d'organisation de fichiers sur macOS, utilisant une IA locale (Ollama) pour analyser et recommander la suppression ou conservation des fichiers.

## ✨ Nouvelles Fonctionnalités v3.0

### 1. **✅ Persistance de l'état**
- L'état complet est sauvegardé dans `localStorage`
- Pas de perte de progression lors du rechargement de la page
- Les logs, résultats et paramètres sont conservés

### 2. **✅ Layout 3 colonnes**
```
┌─────────────┬──────────────────┬─────────────┐
│   Options   │  Suppression     │    Logs     │
│   & Scan    │    Rapide        │             │
└─────────────┴──────────────────┴─────────────┘
```

### 3. **✅ Sélecteur de dossier Finder**
- Clic sur "📁 Choisir un dossier" ouvre le Finder natif
- Plus besoin de taper le chemin manuellement
- Utilise AppleScript pour l'intégration macOS

### 4. **✅ Exclusion de types de fichiers**
Options pour exclure du scan :
- Fichiers audio
- Images
- Vidéos

### 5. **✅ Suppression dossiers/fichiers vides**
- Option activée par défaut
- Nettoie automatiquement avant le scan

### 6. **✅ Organisation des fichiers conservés**
Après suppression, les fichiers conservés sont organisés par type dans :
```
Dossier_scanné/
└── AI_Cleaner_Organized/
    ├── Images/
    ├── Documents/
    ├── Code/
    └── ...
```

### 7. **✅ Boutons Stop/Restart**
- **Stop** : Arrête le processus en cours
- **Restart** : Réinitialise tout (état + localStorage)

### 8. **✅ Auto-scroll désactivable**
- Option pour empêcher le scroll automatique des logs
- Utile pour consulter les anciens logs

### 9. **✅ Timeout augmenté pour PDFs**
- 60 secondes pour fichiers > 1MB (au lieu de 20s)
- Plus d'erreurs de timeout sur gros PDFs

### 10. **✅ Prompt JSON amélioré**
Nouveau prompt ultra-strict pour forcer le JSON :
```
INSTRUCTIONS CRITIQUES:
- Réponds UNIQUEMENT avec un JSON valide
- PAS de texte avant ou après
- PAS de markdown
- Format EXACT requis
```

### 11. **✅ Kill script à la fermeture**
- `beforeunload` event appelle `/api/stop`
- Le backend s'arrête proprement

## 🚀 Installation

### Prérequis
```bash
# Installer Ollama
brew install ollama

# Installer le modèle
ollama pull llama3:8b
```

### Dépendances Python
```bash
pip3 install -r requirements.txt
```

### Fichiers requis
```
.
├── webapp_backend_v3.py
├── index_v3.html
├── requirements.txt
└── start_webapp_v3.sh
```

## 🎯 Utilisation

### Démarrage rapide
```bash
./start_webapp_v3.sh
```

### Accès
Ouvre ton navigateur : **http://localhost:5000**

### Workflow typique

1. **Choisir un dossier**
   - Clic sur "📁 Choisir un dossier"
   - Sélectionne via Finder

2. **Configurer les options**
   - Âge minimum des fichiers
   - Taille minimum
   - Exclusions de types
   - Autres options

3. **Scanner**
   - Clic sur "🔍 Scanner"
   - Attendre le résumé des statistiques

4. **Option A : Suppression rapide**
   - Coche les catégories à supprimer
   - Clic sur "🗑️ Supprimer les catégories cochées"
   - **Attention** : pas d'analyse IA, suppression directe !

5. **Option B : Analyse IA**
   - Clic sur "🧠 Analyser avec IA"
   - L'IA analyse chaque fichier
   - Voir les logs en temps réel
   - Validation finale avec "🗑️ Tout supprimer"

## 🐛 Résolution des Problèmes

### Problème : JSON invalide dans les logs
**Cause** : Ollama ne renvoie pas de JSON valide  
**Solution** : Le nouveau prompt v3.0 est beaucoup plus strict

### Problème : Timeout sur gros PDFs
**Cause** : Timeout trop court (20s)  
**Solution** : v3.0 utilise 60s pour fichiers > 1MB

### Problème : Le site scroll tout seul
**Cause** : Auto-scroll activé  
**Solution** : Décoche "Auto-scroll des logs" dans les options

### Problème : Perte de progression au reload
**Cause** : Pas de persistance  
**Solution** : v3.0 sauvegarde tout dans localStorage

### Problème : Le script continue après fermeture
**Cause** : Pas de cleanup  
**Solution** : v3.0 kill le script avec `beforeunload`

## 📊 Architecture

### Frontend (React)
- **index_v3.html** : Interface React complète
- Layout 3 colonnes responsive
- WebSocket pour temps réel
- localStorage pour persistance

### Backend (Flask)
- **webapp_backend_v3.py** : API REST + WebSocket
- Scan multi-threadé
- Analyse IA par batch
- Organisation automatique des fichiers

### Communication
```
Frontend ←→ WebSocket ←→ Backend
            (temps réel)
            
Frontend ←→ REST API ←→ Backend
            (actions)
```

## 🔧 API Endpoints

### POST `/api/select_folder`
Ouvre le sélecteur Finder natif
```json
Response: {"path": "/Users/..."}
```

### POST `/api/scan`
Lance le scan du dossier
```json
{
  "path": "/Users/.../Downloads",
  "min_age_days": 30,
  "min_size_mb": 20,
  "exclude_audio": false,
  "exclude_images": false,
  "exclude_videos": false,
  "delete_empty": true
}
```

### POST `/api/analyze`
Lance l'analyse IA
```json
{
  "model": "llama3:8b",
  "max_files": 100
}
```

### POST `/api/stop`
Arrête le processus en cours

### GET `/api/results`
Récupère les résultats

### POST `/api/delete`
Supprime les fichiers + organise si demandé
```json
{
  "files": ["/path/to/file1", ...],
  "organize_kept": true
}
```

### POST `/api/delete_by_category`
Suppression rapide par catégorie
```json
{
  "categories": ["Screenshots", "Videos"]
}
```

## 📈 Évolution du Projet

### v1.0 - Script Python CLI
- Scan basique
- Analyse IA manuelle

### v2.0 - WebApp
- Interface web
- Temps réel via WebSocket
- Suppression rapide

### v3.0 - Production Ready ✨
- **Toutes les fonctionnalités demandées**
- Persistance complète
- UX améliorée
- Gestion d'erreurs robuste
- Organisation automatique

## 🎨 Personnalisation

### Changer le modèle Ollama
Dans l'interface, modifier "model" dans la config

### Ajuster les catégories
Éditer `CATEGORIES` dans `webapp_backend_v3.py`

### Modifier les dossiers ignorés
Éditer `IGNORED_DIRS` dans `webapp_backend_v3.py`

## 📝 Notes Techniques

### Prompt JSON
Le prompt v3.0 est **ultra-strict** pour éviter les réponses narratives :
- Pas de markdown
- JSON obligatoire
- Format exact imposé
- Température = 0 (déterministe)

### Timeout adaptatif
```python
timeout = 60 if file_size > 1MB else 30
```

### Organisation des fichiers
```python
AI_Cleaner_Organized/
├── Images/
│   ├── photo1.jpg
│   └── screenshot_2.png
├── Documents/
│   └── facture.pdf
└── Code/
    └── script.py
```

### Persistance
Tout est sauvegardé :
- `status`, `config`, `logs`
- `scanProgress`, `analyzeProgress`
- `results`, `stats`

## 🚨 Avertissements

⚠️ **La suppression est DÉFINITIVE** - pas de corbeille  
⚠️ **Teste d'abord sur un dossier de test**  
⚠️ **Fais des backups avant utilisation**  
⚠️ **Vérifie les résultats avant de supprimer**

## 🤝 Contribution

Améliorations possibles :
- Support multi-langues
- Preview des fichiers avant suppression
- Statistiques détaillées
- Export des résultats en CSV
- Mode dry-run (simulation)

## 📄 Licence

Usage personnel - Pas de garantie

## 👨‍💻 Auteur

B - Transition IT/Cybersécurité  
ENI Rennes - TSSR en alternance

---

**Version** : 3.0  
**Dernière mise à jour** : Novembre 2025  
**Status** : ✅ Production Ready
