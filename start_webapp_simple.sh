#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     🌐 AI CLEANER WEBAPP v3.0 - Version Simplifiée           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Créer le dossier static
mkdir -p static

# Copier le frontend
if [ -f "index_v3_fixed.html" ]; then
    cp index_v3_fixed.html static/index.html
    echo "✅ Frontend installé"
elif [ -f "index_v3.html" ]; then
    cp index_v3.html static/index.html
    echo "✅ Frontend original copié"
fi

# Créer un venv léger si nécessaire
if [ ! -d "venv" ]; then
    echo "📦 Création de l'environnement virtuel..."
    python3 -m venv venv
fi

echo "🔧 Activation de l'environnement..."
source venv/bin/activate

# Installer uniquement les dépendances essentielles
echo "📦 Installation des dépendances minimales..."
cat > requirements_minimal.txt << EOF
Flask==2.3.2
flask-cors==4.0.0
flask-socketio==5.3.4
python-socketio[client]==5.9.0
eventlet==0.33.3
EOF

# Installer sans compiler les wheels
pip install --no-compile --disable-pip-version-check -q -r requirements_minimal.txt

echo ""
echo "✨ Fonctionnalités :"
echo "   • Sélecteur de dossier graphique"
echo "   • Analyse rapide basée sur des règles"
echo "   • Pas d'IA (pas besoin d'Ollama)"
echo "   • Démarrage rapide"
echo ""
echo "🚀 Lancement..."
echo "   URL: http://localhost:5000"
echo ""
echo "💡 Ctrl+C pour arrêter"
echo ""

# Lancer le backend simplifié
if [ -f "webapp_backend_v3_simple.py" ]; then
    python3 webapp_backend_v3_simple.py
else
    echo "❌ Fichier webapp_backend_v3_simple.py non trouvé"
    echo "   Utilisez le backend d'origine..."
    python3 webapp_backend_v3.py
fi
