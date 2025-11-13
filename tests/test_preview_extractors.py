import importlib.util
import os
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path


def _install_backend_stubs():
    if 'flask' not in sys.modules:
        flask_stub = types.ModuleType('flask')

        class DummyFlask:
            def __init__(self, *args, **kwargs):
                pass

            def route(self, *args, **kwargs):
                def decorator(func):
                    return func

                return decorator

        class DummyRequest:
            def __init__(self):
                self.files = {}
                self.form = {}
                self.args = {}

            def get_json(self, silent=False):
                return {}

        def jsonify(*args, **kwargs):
            return {'_json': args or kwargs}

        flask_stub.Flask = DummyFlask
        flask_stub.jsonify = jsonify
        flask_stub.request = DummyRequest()
        flask_stub.send_from_directory = lambda *args, **kwargs: None
        flask_stub.send_file = lambda *args, **kwargs: None
        sys.modules['flask'] = flask_stub

    if 'flask_cors' not in sys.modules:
        cors_stub = types.ModuleType('flask_cors')

        def _cors(app, *args, **kwargs):
            return app

        cors_stub.CORS = _cors
        sys.modules['flask_cors'] = cors_stub

    if 'flask_socketio' not in sys.modules:
        socketio_stub = types.ModuleType('flask_socketio')

        class DummySocketIO:
            def __init__(self, app, **kwargs):
                self.app = app

            def emit(self, *args, **kwargs):
                return None

            def sleep(self, *args, **kwargs):
                return None

            def on(self, *args, **kwargs):
                def decorator(func):
                    return func

                return decorator

            on_event = on

        socketio_stub.SocketIO = DummySocketIO
        socketio_stub.emit = lambda *args, **kwargs: None
        sys.modules['flask_socketio'] = socketio_stub

    if 'requests' not in sys.modules:
        requests_stub = types.ModuleType('requests')

        class DummyResponse:
            def __init__(self, status_code=200, payload=None):
                self.status_code = status_code
                self._payload = payload or {}
                self.text = ''

            def json(self):
                return self._payload

        class DummySession:
            def get(self, *args, **kwargs):
                return DummyResponse()

            def post(self, *args, **kwargs):
                return DummyResponse()

        requests_stub.Session = DummySession
        requests_stub.RequestException = Exception
        sys.modules['requests'] = requests_stub

SAMPLE_PDF_BYTES = b"""%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 72 >>\nstream\nBT /F1 18 Tf 10 100 Td (Concert Ticket Reference ABC123) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000109 00000 n \n0000000255 00000 n \n0000000360 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n447\n%%EOF\n"""

SAMPLE_RTF = """{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil Helvetica;}}\\f0\\fs24 Mot de passe Facebook : Hunter2 }"""


class PreviewExtractorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_backend_stubs()
        module_path = Path(__file__).resolve().parents[1] / 'webapp-backend-python314.py'
        spec = importlib.util.spec_from_file_location('webapp_backend_preview', module_path)
        cls.module = importlib.util.module_from_spec(spec)

        try:
            assert spec.loader is not None
            spec.loader.exec_module(cls.module)  # type: ignore[union-attr]
        except ModuleNotFoundError as exc:  # pragma: no cover - optional deps
            raise unittest.SkipTest(f"Backend dependencies missing: {exc}") from exc

        cls.PdfReader = getattr(cls.module, 'PdfReader', None)
        cls._extract_pdf_preview = staticmethod(cls.module._extract_pdf_preview)
        cls._extract_rtf_preview = staticmethod(cls.module._extract_rtf_preview)
        cls.detect_critical_content = staticmethod(cls.module.detect_critical_content)
        cls.apply_local_rules = staticmethod(cls.module.apply_local_rules)
        cls._looks_like_screenshot = staticmethod(cls.module._looks_like_screenshot)

    def _write_temp(self, suffix: str, data: bytes) -> str:
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
        return path

    def _write_temp_zip(self, filename: str) -> str:
        fd, path = tempfile.mkstemp(suffix='.zip')
        os.close(fd)
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr(filename, b'Placeholder data')
        return path

    def test_pdf_preview_contains_ticket_reference(self):
        path = self._write_temp('.pdf', SAMPLE_PDF_BYTES)
        try:
            preview = self._extract_pdf_preview(path, max_chars=200)
            self.assertIsNotNone(preview)
            self.assertIn('Concert Ticket', preview)
        finally:
            os.unlink(path)

    def test_rtf_preview_extracts_text(self):
        path = self._write_temp('.rtf', SAMPLE_RTF.encode('utf-8'))
        try:
            preview = self._extract_rtf_preview(path, max_chars=120)
            self.assertIsNotNone(preview)
            self.assertIn('Mot de passe Facebook', preview)
        finally:
            os.unlink(path)

    def test_detects_ticket_keyword_inside_archive_members(self):
        path = self._write_temp_zip('billet-concert.pdf')
        try:
            file_info = {
                'name': Path(path).name,
                'path': path,
                'ext': '.zip',
                'category': 'Archives',
                'age': 120,
                'size': os.path.getsize(path),
            }
            reason = self.detect_critical_content(file_info, preview=None)
            self.assertIsNotNone(reason)
            self.assertIn('Ticket / reservation', reason)
        finally:
            os.unlink(path)

    def test_screenshot_detection_handles_combining_accent(self):
        name = 'Capture d\u2019e\u0301cran 2025-11-06 \u00e0 10.44.22.png'
        self.assertTrue(self._looks_like_screenshot(name))

    def test_local_rule_deletes_tiny_untitled_zip(self):
        file_info = {
            'name': 'Sans titre 2.zip',
            'path': '/tmp/Sans titre 2.zip',
            'ext': '.zip',
            'age': 45,
            'size': 1500,
            'category': 'Archives',
        }
        decision = self.apply_local_rules(file_info, preview=None)
        self.assertIsNotNone(decision)
        self.assertTrue(decision['can_delete'])
        self.assertTrue(
            'Untitled' in decision['reason'] or 'Archive smaller' in decision['reason'],
            msg=f"Unexpected reason: {decision['reason']}"
        )


if __name__ == '__main__':
    unittest.main()
