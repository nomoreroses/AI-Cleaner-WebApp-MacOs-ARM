import importlib.util
from pathlib import Path
from typing import Dict, Any

MODULE_PATH = Path(__file__).resolve().parent.parent / 'webapp-backend-python314.py'
spec = importlib.util.spec_from_file_location('backend', MODULE_PATH)
backend = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(backend)  # type: ignore[assignment]


def _make_candidate(name: str, ext: str = '.png', size: int = 1024, age: int = 45) -> Dict[str, Any]:
    return {
        'path': f'/tmp/{name}',
        'name': name,
        'ext': ext,
        'size': size,
        'age': age,
        'category': 'Images'
    }


def test_screenshot_rule_has_priority_over_critical_content() -> None:
    file_info = _make_candidate("Capture d'écran 2024-05-01.png")
    decision = backend.apply_local_rules(file_info, preview="Invoice number 12345")
    assert decision is not None
    assert decision['can_delete'] is True
    assert 'Screenshot-style' in decision['reason']


def test_screenshot_detection_covers_common_mac_variants() -> None:
    variants = [
        "Capture d’écran 2024-05-01 à 10.20.11.png",
        "Capture d'ecran 2024-05-01 a 10.20.11.png",
        "Capture decran 2024-05-01 a 10.20.11.png",
        "Capture_d’écran_2024-05-01.png",
    ]

    for name in variants:
        assert backend._looks_like_screenshot(name)
