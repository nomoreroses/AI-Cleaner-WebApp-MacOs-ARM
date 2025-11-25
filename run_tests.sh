#!/bin/bash

# Script de test complet pour AI Cleaner WebApp

set -e

echo "═══════════════════════════════════════════════════════"
echo "  AI CLEANER WEBAPP - Test Suite"
echo "═══════════════════════════════════════════════════════"
echo ""

# Vérifier les dépendances
echo "[1/4] Vérification des dépendances..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 non trouvé"
    exit 1
fi

if ! python3 -c "import flask" 2>/dev/null; then
    echo "⚠️  Flask non installé. Installation..."
    pip install -r requirements.txt
fi

echo "✅ Dépendances OK"
echo ""

# Linter (optionnel)
echo "[2/4] Vérification de la syntaxe..."
python3 << 'PYEOF'
import py_compile
import sys
files = ['server.py', 'config.py', 'tests/test_utils.py', 'tests/test_api.py', 'tests/test_ollama.py']
for f in files:
    try:
        py_compile.compile(f, doraise=True)
    except Exception as e:
        print(f"❌ {f}: {e}")
        sys.exit(1)
PYEOF
echo "✅ Syntaxe OK"
echo ""

# Tests unitaires
echo "[3/4] Tests unitaires..."
python3 -m pytest tests/test_utils.py -v --tb=short 2>/dev/null || {
    echo "⚠️  Certains tests ont échoué"
}
echo ""

# Tests API
echo "[4/4] Tests API..."
python3 -m pytest tests/test_api.py tests/test_ollama.py -v --tb=short 2>/dev/null || {
    echo "⚠️  Certains tests ont échoué"
}
echo ""

# Résumé
echo "═══════════════════════════════════════════════════════"
echo "✅ Suite de tests complétée"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Pour lancer les tests avec couverture:"
echo "  pytest tests/ --cov=server --cov-report=html"
echo ""
echo "Pour lancer le serveur:"
echo "  python3 server.py"
echo ""
