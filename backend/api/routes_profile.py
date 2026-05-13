from fastapi import APIRouter, Depends

from schemas import SecurityActor
from security import require_actor
from services.application import profile_app_service
from token_server import (
    CandidateProfileRequest,
    CandidateProfileResponse,
)


router = APIRouter(tags=["profile"])


@router.post("/candidate/profile", response_model=CandidateProfileResponse)
async def candidate_profile(
    request: CandidateProfileRequest,
    actor: SecurityActor = Depends(require_actor),
) -> CandidateProfileResponse:
    return await profile_app_service.build_candidate_profile(request, actor)
