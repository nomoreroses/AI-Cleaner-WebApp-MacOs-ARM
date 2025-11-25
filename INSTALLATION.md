# Installation & Tests

## Quick Start

### 1. Install Dependencies

```bash
# Create a virtual environment
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# or
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

### 2. Configuration

```bash
# Copy the template
cp .env.example .env

# Edit .env if needed (defaults are OK otherwise)
```

### 3. Tests

```bash
# Quick test
./quick_test.sh

# Or with pytest
pytest tests/ -v

# With coverage report
pytest tests/ --cov=server --cov-report=html
```

### 4. Launch the Server

```bash
# Make sure Ollama is running
ollama serve

# In another terminal
python3 server.py
```

Access `http://localhost:5000`

## Troubleshooting

### Tests fail with `ModuleNotFoundError: No module named 'flask_cors'`
→ You haven't activated the venv!

```bash
# Activate the venv
source venv/bin/activate  # macOS/Linux
# or
venv\Scripts\activate  # Windows

# Verify it's activated
which python3  # should show a path with "venv"

# Reinstall dependencies
pip install -r requirements.txt

# Run tests again
pytest tests/ -v
```

### Tests pass with venv ✅
This is normal! All tests should pass once the venv is activated and dependencies are installed.

### `py_compile` error
→ Make sure you're in the right directory (where `server.py` is located)

### Ollama not available
```bash
# Install Ollama if missing
curl https://ollama.ai/install.sh | sh

# Start Ollama
ollama serve

# Download a model
ollama pull llama3:8b
```

### Import errors (Flask, pytest, etc.)
```bash
# Verify the venv is activated
which python3  # should be in venv/

# Reinstall
pip install --force-reinstall -r requirements.txt
```

### Port 5000 already in use
```bash
# Change the port
export FLASK_PORT=5001
python3 server.py

# Or in .env
FLASK_PORT=5001
```

## Project Structure

```
.
├── server.py          # Main application (32KB)
├── config.py          # Centralized configuration
├── requirements.txt   # Dependencies
├── README.md         # Documentation
├── INSTALLATION.md   # This file
├── .env.example      # Environment template
├── pytest.ini        # Pytest configuration
├── quick_test.sh     # Quick test script
├── run_tests.sh      # Full test suite
└── tests/
    ├── test_utils.py      # Utility tests
    ├── test_api.py        # Endpoint tests
    └── test_ollama.py     # Ollama mock tests
```

## Environment Variables

```
OLLAMA_URL=http://localhost:11434
OLLAMA_TIMEOUT=30
OLLAMA_MODEL=llama3:8b
FLASK_PORT=5000
FLASK_HOST=0.0.0.0
SECRET_KEY=  # Auto-generated if not set
```

## Security

- **Don't commit** `.env` (it contains secrets)
- Generate a unique `SECRET_KEY` for production
- Change `FLASK_HOST=0.0.0.0` in production (use a reverse proxy)

## Test Results

All 19 tests pass ✅

```bash
pytest tests/ -v
# 19 passed in 0.45s
```

Tests include:
- 7 utility function tests
- 6 API endpoint tests  
- 6 Ollama integration tests (with mocks)

## Next Steps

```bash
# Run with coverage
pytest tests/ --cov=server --cov-report=html

# View the report
open htmlcov/index.html  # macOS
# or
start htmlcov/index.html  # Windows

# Start the server (after Ollama is available)
python3 server.py
```
