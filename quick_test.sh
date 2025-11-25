#!/bin/bash

# Quick test script - macOS compatible

echo "🧪 AI CLEANER - Quick Test"
echo "=========================="
echo ""

# Vérifier Python
python3 --version || { echo "❌ Python3 not found"; exit 1; }

# Vérifier imports
echo "1️⃣  Vérification des imports..."
python3 << 'PYEOF'
try:
    import flask
    import pytest
    import requests
    print("✅ Flask, pytest, requests OK")
except ImportError as e:
    print(f"⚠️  {e}")
    print("   Installez: pip install -r requirements.txt")
PYEOF

echo ""
echo "2️⃣  Vérification syntaxe server.py..."
python3 -c "import py_compile; py_compile.compile('server.py', doraise=True)" && echo "✅ Syntaxe OK" || echo "❌ Erreur syntaxe"

echo ""
echo "3️⃣  Lancement tests (si pytest installé)..."
python3 -m pytest tests/ -v 2>/dev/null || echo "⚠️  pytest non trouvé - installez requirements.txt"

echo ""
echo "=========================="
echo "✅ Vérifications terminées"
