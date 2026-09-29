import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

from app import app
from content import TEXTS_BASE_DIR, normalize_study_mode, parse_text_content
from scripts.refine_text_files import refine_file


class ApplicationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_api_rejects_paths_outside_text_library(self) -> None:
        response = self.client.get("/api/browse/../")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.content_type, "application/json")
        self.assertEqual(response.get_json(), {"message": "Invalid path"})

    def test_responses_include_browser_security_policy(self) -> None:
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Referrer-Policy"], "same-origin")
        self.assertEqual(
            response.headers["Permissions-Policy"],
            "camera=(), geolocation=(), microphone=()",
        )

    def test_static_assets_are_versioned_for_browser_cache_refresh(self) -> None:
        response = self.client.get("/")
        html = response.get_data(as_text=True)

        self.assertRegex(html, r'<meta name="app-assets-version" content="\d+">')
        self.assertRegex(html, r'/static/css/study\.css\?v=\d+')
        self.assertRegex(html, r'/static/js/navigation\.js\?v=\d+')

    def test_notes_is_the_default_study_mode(self) -> None:
        self.assertEqual(normalize_study_mode(None), "notes")
        self.assertEqual(normalize_study_mode("unknown"), "notes")
        self.assertEqual(normalize_study_mode("practice"), "practice")

        text_path = next(TEXTS_BASE_DIR.rglob("*.txt")).relative_to(TEXTS_BASE_DIR).as_posix()
        encoded_path = quote(text_path, safe="/")
        response = self.client.get(f"/study/{encoded_path}")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertRegex(
            html,
            r'class="study-mode-button active"[^>]*>필기</a>',
        )

        legacy_response = self.client.get(f"/practice/{encoded_path}")
        self.assertEqual(legacy_response.status_code, 302)
        self.assertTrue(legacy_response.location.endswith("?mode=practice"))

    def test_repository_texts_keep_the_alternating_translation_contract(self) -> None:
        text_paths = sorted(TEXTS_BASE_DIR.rglob("*.txt"))
        self.assertTrue(text_paths)

        for text_path in text_paths:
            with self.subTest(text_path=text_path.relative_to(TEXTS_BASE_DIR)):
                parsed = parse_text_content(text_path.read_text(encoding="utf-8"))
                line_pairs = parsed["line_pairs"]
                self.assertTrue(line_pairs)
                self.assertTrue(all(pair["english"] for pair in line_pairs))
                self.assertTrue(all(pair["korean"] for pair in line_pairs))
                self.assertEqual(parsed["english_content"].count("**") % 2, 0)


class RefineTextFilesTests(unittest.TestCase):
    def test_refinement_preserves_the_first_line_and_is_idempotent(self) -> None:
        source = (
            "Thoughtful learners practice deliberately.\n"
            "사려 깊은 학습자는 의도적으로 연습한다.\n"
            "Deliberate practice strengthens understanding.\n"
            "의도적인 연습은 이해를 강화한다.\n"
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            text_path = Path(temporary_directory) / "sample.txt"
            text_path.write_text(source, encoding="utf-8")

            refine_file(text_path)
            first_result = text_path.read_text(encoding="utf-8")
            refine_file(text_path)
            second_result = text_path.read_text(encoding="utf-8")

        self.assertIn("Thoughtful", first_result.splitlines()[0])
        self.assertIn("**", first_result)
        self.assertEqual(second_result, first_result)


if __name__ == "__main__":
    unittest.main()
