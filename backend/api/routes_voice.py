from fastapi import APIRouter, Depends, File, Form, UploadFile

from schemas import SecurityActor
from security import require_actor
from services.application import livekit_token_app_service, voice_app_service
from token_server import (
    TextTurnRequest,
    TokenRequest,
    TokenResponse,
    VoiceTurnResponse,
)


router = APIRouter(tags=["voice"])


@router.post("/speech/transcribe")
async def transcribe_speech(
    file: UploadFile = File(...),
    actor: SecurityActor = Depends(require_actor),
) -> dict[str, str | None]:
    return await voice_app_service.transcribe_speech(file, actor)


@router.post("/text-turn", response_model=VoiceTurnResponse)
async def text_turn(
    request: TextTurnRequest,
    actor: SecurityActor = Depends(require_actor),
) -> VoiceTurnResponse:
    return await voice_app_service.text_turn(request, actor)


@router.post("/token", response_model=TokenResponse)
def create_token(
    request: TokenRequest,
    actor: SecurityActor = Depends(require_actor),
) -> TokenResponse:
    return livekit_token_app_service.create_token(request, actor)


@router.post("/voice-turn", response_model=VoiceTurnResponse)
async def voice_turn(
    file: UploadFile = File(...),
    history: str | None = Form(default=None),
    context: str | None = Form(default=None),
    mode: str = Form(default="general"),
    actor: SecurityActor = Depends(require_actor),
) -> VoiceTurnResponse:
    return await voice_app_service.voice_turn(file, history, context, mode, actor)
