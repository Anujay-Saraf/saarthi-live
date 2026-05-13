import json
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException, Request, UploadFile

from schemas import AuditEvent, SecurityActor


DEFAULT_MAX_UPLOAD_MB = 8
DEFAULT_RATE_LIMIT_PER_MINUTE = 90
ALLOWED_RESUME_EXTENSIONS = {".txt", ".md", ".csv", ".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_AUDIO_EXTENSIONS = {".m4a", ".mp4", ".aac", ".mp3", ".wav", ".webm"}
PROMPT_INJECTION_PATTERNS = (
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"disregard\s+(all\s+)?previous\s+instructions",
    r"system\s*prompt",
    r"developer\s*message",
    r"reveal\s+(the\s+)?prompt",
    r"you\s+are\s+now\s+",
)

_rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def configured_cors_origins() -> list[str]:
    raw = os.getenv("SAARTHI_CORS_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def upload_limit_bytes() -> int:
    try:
        value = float(os.getenv("SAARTHI_MAX_UPLOAD_MB", str(DEFAULT_MAX_UPLOAD_MB)))
    except ValueError:
        value = DEFAULT_MAX_UPLOAD_MB
    return max(1, int(value * 1024 * 1024))


def rate_limit_per_minute() -> int:
    try:
        return max(0, int(os.getenv("SAARTHI_RATE_LIMIT_PER_MINUTE", str(DEFAULT_RATE_LIMIT_PER_MINUTE))))
    except ValueError:
        return DEFAULT_RATE_LIMIT_PER_MINUTE


async def require_actor(
    request: Request,
    x_saarthi_session: str | None = Header(default=None),
    x_saarthi_tenant: str | None = Header(default=None),
    x_saarthi_role: str | None = Header(default=None),
    x_saarthi_api_token: str | None = Header(default=None),
    x_saarthi_consent: str | None = Header(default=None),
) -> SecurityActor:
    expected_token = os.getenv("SAARTHI_API_TOKEN", "").strip()
    if expected_token and x_saarthi_api_token != expected_token:
        raise HTTPException(status_code=401, detail="Missing or invalid Saarthi API token.")
    if os.getenv("SAARTHI_REQUIRE_CONSENT", "0").strip().lower() in {"1", "true", "yes"}:
        if (x_saarthi_consent or "").strip().lower() not in {"1", "true", "yes", "accepted"}:
            raise HTTPException(status_code=428, detail="Consent is required before using voice/resume services.")

    session_id = clean_identifier(x_saarthi_session or request.client.host if request.client else "anonymous")
    tenant_id = clean_identifier(x_saarthi_tenant or "default")
    role = clean_identifier(x_saarthi_role or "user")
    actor = SecurityActor(session_id=session_id, tenant_id=tenant_id, role=role)
    enforce_rate_limit(actor, request.url.path)
    return actor


def require_admin(actor: SecurityActor) -> None:
    if actor.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")


def clean_identifier(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.:@-]", "-", str(value).strip())[:96]
    return cleaned or "anonymous"


def enforce_rate_limit(actor: SecurityActor, endpoint: str) -> None:
    limit = rate_limit_per_minute()
    if limit <= 0:
        return

    key = f"{actor.tenant_id}:{actor.session_id}:{endpoint}"
    now = time.monotonic()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment and try again.")
    bucket.append(now)


def validate_upload_metadata(file: UploadFile, allowed_extensions: set[str], label: str) -> None:
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower()
    if suffix and suffix not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported {label} file type: {suffix}")


def validate_upload_size(content: bytes, label: str) -> None:
    if len(content) > upload_limit_bytes():
        max_mb = upload_limit_bytes() / (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"{label} upload is too large. Limit is {max_mb:.0f} MB.")


def basic_malware_screen(content: bytes, label: str) -> None:
    lowered = content[:4096].lower()
    risky_markers = (b"<script", b"powershell", b"cmd.exe", b"/bin/sh", b"eval(", b"wscript.shell")
    if any(marker in lowered for marker in risky_markers):
        raise HTTPException(status_code=400, detail=f"{label} upload contains unsafe executable/script markers.")


def redact_pii(text: str, max_chars: int = 240) -> str:
    clipped = str(text or "")[:max_chars]
    clipped = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", clipped)
    clipped = re.sub(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)", "[phone]", clipped)
    clipped = re.sub(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", "[id]", clipped)
    return clipped


def sanitize_untrusted_text(text: str, max_chars: int = 7000) -> tuple[str, list[str]]:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", str(text or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    notes: list[str] = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, cleaned, flags=re.IGNORECASE):
            notes.append("prompt-injection-marker-removed")
            cleaned = re.sub(pattern, "[removed unsafe instruction]", cleaned, flags=re.IGNORECASE)
    if len(cleaned) > max_chars:
        notes.append("content-truncated")
        cleaned = cleaned[:max_chars]
    return cleaned, notes


def append_audit_event(event: AuditEvent) -> None:
    if os.getenv("SAARTHI_AUDIT_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        return

    path = Path(os.getenv("SAARTHI_AUDIT_LOG_PATH", "appendix/audit-events.jsonl"))
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = event.model_dump() if hasattr(event, "model_dump") else event.dict()
        payload["ts"] = int(time.time())
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return


def audit(endpoint: str, actor: SecurityActor, event_type: str, metadata: dict[str, Any] | None = None) -> None:
    clean_metadata = metadata or {}
    append_audit_event(
        AuditEvent(
            event_type=event_type,
            endpoint=endpoint,
            actor=actor,
            metadata=clean_metadata,
        )
    )
