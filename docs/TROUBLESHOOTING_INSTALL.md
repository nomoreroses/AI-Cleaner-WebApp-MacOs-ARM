# 🔧 TROUBLESHOOTING - Installation

## ❌ Erreur: "externally-managed-environment"

### Problème
```
error: externally-managed-environment
ModuleNotFoundError: No module named 'flask_cors'
```

### 🎯 Solution Rapide (Recommandée)

```bash
cd ~/AI_Cleaner_v3

# 1. Créer l'environnement virtuel
python3 -m venv venv

# 2. L'activer
source venv/bin/activate

# 3. Installer les dépendances
pip install -r requirements.txt

# 4. Lancer l'app
python3 webapp_backend_v3.py
```

### 🔄 Ou utilise le script corrigé

```bash
# Remplace start_webapp_v3.sh par start_webapp_v3_fixed.sh
chmod +x start_webapp_v3_fixed.sh
./start_webapp_v3_fixed.sh
```

### 📝 Pour les prochaines fois

Une fois le venv créé, active-le toujours avant de lancer :

```bash
cd ~/AI_Cleaner_v3
source venv/bin/activate
python3 webapp_backend_v3.py
```

---

## 🆘 Autres Problèmes Courants

### Port 5000 déjà utilisé

```bash
# Trouver le processus
lsof -i :5000

# Le tuer
kill -9 <PID>
```

### Ollama ne démarre pas

```bash
# Vérifier si installé
ollama --version

# Démarrer manuellement
ollama serve
```

### Modèle manquant

```bash
# Télécharger llama3:8b
ollama pull llama3:8b

# Vérifier
ollama list
```

### Erreur "command not found: ollama"

```bash
# Installer Ollama
brew install ollama
```

### Frontend non trouvé (404)

```bash
# Vérifier que static/index.html existe
ls -la static/

# Si manquant, copier manuellement
mkdir static
cp index_v3.html static/index.html
```

---

## ✅ Checklist de Démarrage

- [ ] Ollama installé (`brew install ollama`)
- [ ] Modèle téléchargé (`ollama pull llama3:8b`)
- [ ] Venv créé (`python3 -m venv venv`)
- [ ] Venv activé (`source venv/bin/activate`)
- [ ] Dépendances installées (`pip install -r requirements.txt`)
- [ ] Fichiers dans le bon dossier
- [ ] Script exécutable (`chmod +x start_webapp_v3.sh`)

---

## 🔍 Debug Mode

Si ça ne marche toujours pas :

```bash
# Activer le mode debug
export FLASK_DEBUG=1

# Lancer avec logs verbeux
python3 webapp_backend_v3.py
```

Les logs t'aideront à identifier le problème exact.

---

## 📞 Vérification Complète

```bash
# 1. Vérifier Python
python3 --version  # Doit être 3.8+

# 2. Vérifier Ollama
ollama --version

# 3. Vérifier le modèle
ollama list | grep llama3

# 4. Vérifier les fichiers
ls -la ~/AI_Cleaner_v3/

# 5. Vérifier le venv
ls -la venv/

# 6. Tester l'import
source venv/bin/activate
python3 -c "import flask; print('Flask OK')"
python3 -c "import flask_cors; print('CORS OK')"
python3 -c "import flask_socketio; print('SocketIO OK')"
```

Si tous les checks passent, ça devrait marcher ! 🎉
