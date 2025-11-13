import importlib.util
from pathlib import Path
import os
import unittest


class TestPkgutilShim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Force the shim to activate for the test module load
        cls._prev_force = os.environ.get('FORCE_PKGUTIL_SHIM')
        os.environ['FORCE_PKGUTIL_SHIM'] = '1'
        module_path = Path(__file__).resolve().parents[1] / 'webapp-backend-python314.py'
        spec = importlib.util.spec_from_file_location('webapp_backend_test', module_path)
        cls.module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        try:
            spec.loader.exec_module(cls.module)
        except ModuleNotFoundError as exc:  # pragma: no cover - optional deps
            raise unittest.SkipTest(f"Dépendance manquante pour le backend: {exc}") from exc

    @classmethod
    def tearDownClass(cls):
        if cls._prev_force is None:
            os.environ.pop('FORCE_PKGUTIL_SHIM', None)
        else:
            os.environ['FORCE_PKGUTIL_SHIM'] = cls._prev_force

    def test_loader_returns_stdlib(self):
        loader = self.module.pkgutil.get_loader('json')
        self.assertIsNotNone(loader, 'std lib module should have a loader')

    def test_loader_handles_missing_module(self):
        loader = self.module.pkgutil.get_loader('no_such_module_12345')
        self.assertIsNone(loader)


if __name__ == '__main__':
    unittest.main()
