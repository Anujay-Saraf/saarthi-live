import os

from fastapi import APIRouter, Depends, Query, Response

from schemas import SecurityActor
from security import configured_cors_origins, require_actor, require_admin, upload_limit_bytes
from services.application import system_app_service
from token_server import graph_available, make_handoff_tone


router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return system_app_service.health()


@router.get("/security/status")
async def security_status(actor: SecurityActor = Depends(require_actor)) -> dict[str, object]:
    require_admin(actor)
    return {
        "cors_origins": configured_cors_origins(),
        "api_token_auth": bool(os.getenv("SAARTHI_API_TOKEN", "").strip()),
        "rate_limit_per_minute": os.getenv("SAARTHI_RATE_LIMIT_PER_MINUTE", "90"),
        "max_upload_mb": upload_limit_bytes() // (1024 * 1024),
        "audit_enabled": os.getenv("SAARTHI_AUDIT_ENABLED", "1"),
        "consent_required": os.getenv("SAARTHI_REQUIRE_CONSENT", "0"),
        "retention_policy": os.getenv("SAARTHI_RETENTION_POLICY", "No conversation DB; metadata audit only."),
        "graph": "langgraph" if graph_available() else "pydantic-fallback",
        "persistence": "metadata audit only; no conversation database",
    }


@router.get("/handoff-tone")
def handoff_tone() -> Response:
    return Response(
        content=make_handoff_tone(),
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/tts")
async def create_tts_audio(
    text: str = Query(..., min_length=1, max_length=500),
    language_code: str | None = Query(default="hi-IN"),
    actor: SecurityActor = Depends(require_actor),
) -> Response:
    content, media_type = await system_app_service.tts_audio(text, language_code, actor)
    return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})
