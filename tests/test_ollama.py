"""Tests d'intégration - Ollama Mock"""

import pytest
import json
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


@patch('server.requests.Session.post')
def test_call_ollama_success(mock_post):
    """Test appel Ollama réussi"""
    from server import call_ollama
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        'response': json.dumps({
            'can_delete': False,
            'reason': 'Important document',
            'importance': 'high'
        })
    }
    mock_post.return_value = mock_response
    
    with patch('server.check_ollama_availability', return_value=True):
        result, error = call_ollama("Test prompt")
    
    assert result is not None
    assert error is None
    assert result['can_delete'] == False


@patch('server.requests.Session.post')
def test_call_ollama_timeout(mock_post):
    """Test timeout Ollama"""
    from server import call_ollama
    import requests
    
    mock_post.side_effect = requests.exceptions.Timeout()
    
    with patch('server.check_ollama_availability', return_value=True):
        result, error = call_ollama("Test prompt")
    
    assert result is None
    assert error is not None
    assert 'Timeout' in error


@patch('server.requests.Session.post')
def test_call_ollama_connection_error(mock_post):
    """Test erreur de connexion Ollama"""
    from server import call_ollama
    import requests
    
    mock_post.side_effect = requests.exceptions.ConnectionError()
    
    with patch('server.check_ollama_availability', return_value=True):
        result, error = call_ollama("Test prompt")
    
    assert result is None
    assert 'Impossible' in error


@patch('server.requests.Session.post')
def test_call_ollama_invalid_json(mock_post):
    """Test réponse JSON invalide"""
    from server import call_ollama
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        'response': 'Invalid JSON response not matching schema'
    }
    mock_post.return_value = mock_response
    
    with patch('server.check_ollama_availability', return_value=True):
        result, error = call_ollama("Test prompt")
    
    assert result is None
    assert 'JSON invalide' in error


@patch('server.requests.Session.get')
def test_check_ollama_available(mock_get):
    """Test Ollama disponible"""
    from server import check_ollama_availability
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_get.return_value = mock_response
    
    result = check_ollama_availability()
    assert result == True


@patch('server.requests.Session.get')
def test_check_ollama_unavailable(mock_get):
    """Test Ollama indisponible"""
    from server import check_ollama_availability
    import requests
    
    mock_get.side_effect = requests.exceptions.ConnectionError()
    
    result = check_ollama_availability()
    assert result == False


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
