# 🚀 Guide de Démarrage Rapide - AI Cleaner v3.0

## ⚡ Installation en 3 minutes

### 1️⃣ Prérequis (si pas déjà fait)
```bash
# Installer Ollama
brew install ollama

# Télécharger le modèle
ollama pull llama3:8b
```

### 2️⃣ Télécharger les fichiers
Tu as besoin de ces 5 fichiers :
- ✅ `index_v3.html`
- ✅ `webapp_backend_v3.py`
- ✅ `requirements.txt`
- ✅ `start_webapp_v3.sh`
- ℹ️ `README_v3.md` (optionnel)

### 3️⃣ Organisation
```bash
# Crée un dossier pour le projet
mkdir ~/AI_Cleaner_v3
cd ~/AI_Cleaner_v3

# Place tous les fichiers dedans
# Puis :
chmod +x start_webapp_v3.sh
```

### 4️⃣ Lancement
```bash
./start_webapp_v3.sh
```

### 5️⃣ Utilisation
Ouvre ton navigateur : **http://localhost:5000**

## 🎯 Premier Scan

1. **Sélectionne un dossier**
   ```
   Clic sur "📁 Choisir un dossier"
   → Finder s'ouvre
   → Sélectionne ton dossier de test
   ```

2. **Configure (optionnel)**
   ```
   Âge minimum : 30 jours
   Taille minimum : 20 MB
   ☑ Supprimer dossiers/fichiers vides
   ```

3. **Lance le scan**
   ```
   Clic sur "🔍 Scanner"
   → Attends le résumé
   ```

4. **Choisis ton action**

   **Option A - Suppression rapide (sans IA)** :
   ```
   ☑ Screenshots
   ☑ Archives
   Clic "🗑️ Supprimer les catégories cochées"
   ```

   **Option B - Analyse IA (plus précis)** :
   ```
   Clic "🧠 Analyser avec IA"
   → Attends l'analyse
   → Revois les résultats
   Clic "🗑️ Tout supprimer"
   ```

## 🛠️ Commandes Utiles

### Arrêter le serveur
```bash
Ctrl + C
```

### Relancer Ollama (si problème)
```bash
killall ollama
ollama serve
```

### Vérifier Ollama
```bash
ollama list
# Doit afficher llama3:8b
```

### Nettoyer localStorage (reset complet)
Dans le navigateur :
```javascript
// Console (F12)
localStorage.clear()
location.reload()
```

## 🐛 Problèmes Fréquents

### "Ollama non trouvé"
```bash
brew install ollama
```

### "Modèle llama3:8b non installé"
```bash
ollama pull llama3:8b
```

### "Port 5000 déjà utilisé"
```bash
# Trouver le processus
lsof -i :5000

# Tuer le processus
kill -9 <PID>
```

### "Frontend non trouvé"
```bash
# Vérifier que static/index.html existe
ls -la static/

# Si manquant, créer le dossier et copier
mkdir static
cp index_v3.html static/index.html
```

### "Connexion WebSocket échoue"
→ Rafraîchir la page (F5)  
→ Vérifier que le backend est lancé

## ⚙️ Configuration Avancée

### Changer le port
Dans `webapp_backend_v3.py` :
```python
socketio.run(app, host='0.0.0.0', port=8080, debug=True)
```

### Modifier les catégories
Dans `webapp_backend_v3.py` :
```python
CATEGORIES = {
    'Images': {'.jpg', '.jpeg', '.png'},
    'Videos': {'.mp4', '.mov'},
    # Ajoute tes catégories ici
}
```

### Changer les dossiers ignorés
```python
IGNORED_DIRS = {
    'node_modules', '.git',
    # Ajoute tes dossiers à ignorer
}
```

## 📊 Exemple de Session Complète

```
🚀 Démarrage
$ ./start_webapp_v3.sh
✅ Ollama trouvé
✅ Modèle llama3:8b prêt
📦 Dépendances installées
🚀 Serveur lancé

📱 Navigateur: http://localhost:5000

┌─────────────────────────────────────┐
│ 🤖 AI Cleaner v3.0                  │
├─────────────────────────────────────┤
│ 📁 Choisir un dossier               │
│ → /Users/B/Downloads                │
│                                     │
│ ⚙️ Options:                          │
│ Âge min: 30j                        │
│ Taille min: 20MB                    │
│ ☑ Supprimer dossiers vides          │
│                                     │
│ [🔍 Scanner]                         │
└─────────────────────────────────────┘

🔍 Scan en cours...
✅ Scan terminé: 1,234 fichiers
   📊 456 candidats

⚡ Suppression rapide:
☑ Screenshots (45 - 230MB)
☑ Archives (12 - 1.2GB)

[🗑️ Supprimer]

✅ Supprimés: 57 fichiers (1.43GB libérés)

🎉 Terminé !
```

## 🎓 Tips & Astuces

### 1. Teste d'abord !
Commence par un petit dossier de test avant ton dossier Downloads

### 2. Utilise les exclusions
Si tu bosses avec de l'audio, coche "Exclure audio"

### 3. Regarde les logs
Les logs en temps réel te montrent ce que l'IA décide

### 4. Organisation auto
Active "Organiser fichiers conservés" pour le rangement auto

### 5. Stop si nécessaire
Pas de panique, le bouton Stop fonctionne instantanément

### 6. Persistance
Si crash/fermeture, recharge la page → tout est sauvegardé !

## 📚 Documentation Complète

Pour plus de détails, voir :
- `README_v3.md` - Documentation complète
- `COMPARISON_v2_v3.md` - Différences v2/v3

## 🆘 Support

En cas de problème :
1. Vérifie les logs dans le terminal
2. Vérifie la console navigateur (F12)
3. Restart complet : Ctrl+C → relancer

## ✨ Fonctionnalités Cool à Essayer

### 1. Persistance
```
1. Lance un scan
2. Ferme le navigateur
3. Rouvre → tout est là !
```

### 2. Organisation
```
☑ Organiser fichiers conservés
→ Fichiers rangés par type automatiquement
```

### 3. Exclusions
```
☑ Exclure audio
☑ Exclure images
→ Scan ultra-ciblé
```

### 4. Suppression rapide
```
Pas besoin d'IA pour les Screenshots
→ Suppression directe !
```

## 🎯 Objectifs Typiques

| Objectif | Stratégie |
|----------|-----------|
| Nettoyer Downloads | Scan → IA → Supprimer |
| Virer les Screenshots | Scan → Suppression rapide |
| Trier les documents | Scan → Organiser |
| Libérer espace disque | Taille min 100MB → Supprimer |

## 🚦 Checklist de Démarrage

- [ ] Ollama installé
- [ ] Modèle llama3:8b téléchargé
- [ ] Fichiers dans ~/AI_Cleaner_v3/
- [ ] start_webapp_v3.sh exécutable
- [ ] Backend lancé
- [ ] Navigateur ouvert sur localhost:5000
- [ ] Premier scan réussi
- [ ] ✅ Ready to clean !

---

**Bon nettoyage ! 🧹✨**
