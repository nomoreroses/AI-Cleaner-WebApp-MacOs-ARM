"""Tests des fonctions utilitaires"""

import pytest
from pathlib import Path
import tempfile
import unicodedata


def test_human_size():
    """Test du formatage de taille"""
    from server import human_size
    
    assert human_size(0) == "0.0B"
    assert human_size(512) == "512.0B"
    assert human_size(1024) == "1.0KB"
    assert human_size(1024 * 1024) == "1.0MB"
    assert human_size(1024 * 1024 * 1024) == "1.0GB"


def test_get_category():
    """Test de catégorisation de fichiers"""
    from server import get_category
    
    assert get_category('.jpg') == 'Images'
    assert get_category('.mp4') == 'Videos'
    assert get_category('.mp3') == 'Audio'
    assert get_category('.pdf') == 'Documents'
    assert get_category('.zip') == 'Archives'
    assert get_category('.py') == 'Code'
    assert get_category('.exe') == 'Installers'
    assert get_category('.xyz') == 'Autres'


def test_normalize():
    """Test de normalisation de texte"""
    from server import _normalize
    
    # Accents
    assert _normalize('café') == 'cafe'
    assert _normalize('Café') == 'cafe'
    
    # Majuscules
    assert _normalize('HELLO') == 'hello'
    assert _normalize('HeLLo') == 'hello'
    
    # Spéciaux
    assert _normalize('test-file') == 'test-file'


def test_is_protected():
    """Test de protection de fichiers"""
    from server import is_protected
    
    # Protégés
    assert is_protected('mon_cv.pdf')[0] == True
    assert is_protected('facture_2024.pdf')[0] == True
    assert is_protected('certificat.pdf')[0] == True
    assert is_protected('DIPLÔME.pdf')[0] == True
    
    # Non protégés
    assert is_protected('screenshot.png')[0] == False
    assert is_protected('random_file.txt')[0] == False


def test_looks_like_screenshot():
    """Test de détection d'écrans"""
    from server import _looks_like_screenshot
    
    assert _looks_like_screenshot('screenshot.png') == True
    assert _looks_like_screenshot('capture d\'ecran.png') == True
    assert _looks_like_screenshot('Screen Shot 2024-01.png') == True
    assert _looks_like_screenshot('photo.jpg') == False
    assert _looks_like_screenshot('document.pdf') == False


def test_apply_local_rules():
    """Test des règles locales"""
    from server import apply_local_rules
    
    # Screenshot -> DELETE
    result = apply_local_rules(
        {'name': 'screenshot.png', 'age': 5, 'ext': '.png', 'size': 100},
        None
    )
    assert result is not None
    assert result['can_delete'] == True
    
    # Fichier protégé -> KEEP
    result = apply_local_rules(
        {'name': 'diplome.pdf', 'age': 365, 'ext': '.pdf', 'size': 1000},
        'contenu'
    )
    assert result is not None
    assert result['can_delete'] == False
    
    # Fichier temporaire ancien -> DELETE
    result = apply_local_rules(
        {'name': 'test_file_temp.txt', 'age': 90, 'ext': '.txt', 'size': 1000},
        None
    )
    assert result is not None
    assert result['can_delete'] == True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
