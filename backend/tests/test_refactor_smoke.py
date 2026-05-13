import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class RefactorSmokeTests(unittest.TestCase):
    def test_app_keeps_public_routes(self) -> None:
        import token_server

        paths = {route.path for route in token_server.app.routes if hasattr(route, "path")}
        expected = {
            "/health",
            "/security/status",
            "/handoff-tone",
            "/speech/transcribe",
            "/text-turn",
            "/candidate/profile",
            "/resume/analyze",
            "/resume/build",
            "/resume/download",
            "/tts",
            "/token",
            "/voice-turn",
        }
        self.assertTrue(expected.issubset(paths))

    def test_document_parser_reads_text(self) -> None:
        from services.document_parser import extract_text_from_file

        text, note = extract_text_from_file("resume.txt", "text/plain", b"Anujay\nAI Engineer")
        self.assertIn("AI Engineer", text)
        self.assertEqual(note, "Text file parsed.")

    def test_resume_builder_agent_repairs_combined_resume(self) -> None:
        from pydantic_agents import ResumeBuilderAgent
        from schemas import ResumeBuildDetails, ResumeProfile

        fallback = ResumeProfile(
            role="Plumber",
            summary="Local plumber",
            skills=["Repair"],
            experience="3 years",
            interview_brief="Ask practical repair questions.",
            resume_text="fallback",
        )
        details = ResumeBuildDetails(name="Ravi", work_type="Plumber", skills="Repair")
        parsed = ResumeBuilderAgent.parse(
            '{"role":"Plumber","resume_text_hi":"Hindi copy","resume_text_en":"English copy"}',
            fallback,
            details,
        )
        self.assertIn("HINDI RESUME", parsed.resume_text)
        self.assertIn("ENGLISH RESUME", parsed.resume_text)

    def test_application_services_are_wired(self) -> None:
        from services.application import profile_app_service, resume_app_service, system_app_service, voice_app_service

        self.assertIsNotNone(voice_app_service.orchestrator)
        self.assertIsNotNone(resume_app_service.llm)
        self.assertIsNotNone(profile_app_service.llm)
        self.assertEqual(system_app_service.health()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
