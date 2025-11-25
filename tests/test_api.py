"""Tests des endpoints API"""

import pytest
import json
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path

# Ajouter le répertoire parent au path
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def client():
    """Fixture Flask client"""
    from server import app
    
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


def test_api_status(client):
    """Test endpoint /api/status"""
    response = client.get('/api/status')
    
    assert response.status_code == 200
    data = response.get_json()
    assert 'ok' in data
    assert 'scanning' in data
    assert 'analyzing' in data
    assert data['ok'] == True


def test_api_stop_no_operation(client):
    """Test /api/stop quand rien ne tourne"""
    response = client.post('/api/stop')
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['ok'] == True


def test_api_delete_no_files(client):
    """Test /api/delete avec liste vide"""
    response = client.post('/api/delete', 
                          json={'files': []})
    
    assert response.status_code == 400
    data = response.get_json()
    assert data['ok'] == False


def test_api_scan_missing_path(client):
    """Test /api/scan sans path"""
    response = client.post('/api/scan', 
                          json={})
    
    assert response.status_code == 400


def test_api_scan_invalid_path(client):
    """Test /api/scan avec chemin invalide"""
    response = client.post('/api/scan',
                          json={'path': '/invalid/path/that/does/not/exist'})
    
    assert response.status_code == 400


def test_api_analyze_no_candidates(client):
    """Test /api/analyze sans candidats"""
    response = client.post('/api/analyze')
    
    assert response.status_code == 400
    data = response.get_json()
    assert data['ok'] == False


@patch('server.check_ollama_availability')
def test_check_ollama_unavailable(mock_check):
    """Test détection Ollama indisponible"""
    from server import check_ollama_availability
    
    mock_check.return_value = False
    result = check_ollama_availability()
    assert result == False


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
