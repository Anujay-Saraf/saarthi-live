"""Protocol interfaces used by application services.

These keep application workflows independent from concrete providers such as
Sarvam, local document parsing, or local audit storage.
"""

from typing import Protocol

from fastapi import UploadFile

from schemas import SecurityActor


class LLMService(Protocol):
    async def complete(self, messages: list[dict[str, str]], max_tokens: int, temperature: float) -> str:
        ...


class SpeechToTextService(Protocol):
    async def transcribe_upload(self, file: UploadFile) -> tuple[str, str | None]:
        ...


class TextToSpeechService(Protocol):
    async def synthesize(self, text: str, language_code: str) -> tuple[bytes, str]:
        ...


class DocumentParserService(Protocol):
    def extract_text(self, filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
        ...


class AuditService(Protocol):
    def record(
        self,
        endpoint: str,
        actor: SecurityActor,
        event_type: str,
        metadata: dict | None = None,
    ) -> None:
        ...


class UploadSecurityService(Protocol):
    def validate_resume_upload(self, file: UploadFile, content: bytes) -> None:
        ...
