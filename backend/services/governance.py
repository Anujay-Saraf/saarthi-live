from fastapi import UploadFile

from schemas import SecurityActor
from security import (
    ALLOWED_RESUME_EXTENSIONS,
    audit,
    basic_malware_screen,
    validate_upload_metadata,
    validate_upload_size,
)


class SecurityAuditService:
    def record(
        self,
        endpoint: str,
        actor: SecurityActor,
        event_type: str,
        metadata: dict | None = None,
    ) -> None:
        audit(endpoint, actor, event_type, metadata or {})


class DefaultUploadSecurityService:
    def validate_resume_upload(self, file: UploadFile, content: bytes) -> None:
        validate_upload_metadata(file, ALLOWED_RESUME_EXTENSIONS, "resume")
        validate_upload_size(content, "Resume")
        basic_malware_screen(content, "Resume")
