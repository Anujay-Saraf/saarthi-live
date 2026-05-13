from fastapi import APIRouter, Depends, File, Form, Response, UploadFile

from schemas import SecurityActor
from security import require_actor
from services.application import resume_app_service
from token_server import (
    ResumeAnalyzeResponse,
    ResumeBuildRequest,
    ResumeDownloadRequest,
)


router = APIRouter(tags=["resume"])


@router.post("/resume/analyze", response_model=ResumeAnalyzeResponse)
async def analyze_resume(
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
    actor: SecurityActor = Depends(require_actor),
) -> ResumeAnalyzeResponse:
    return await resume_app_service.analyze(file, text, actor)


@router.post("/resume/build", response_model=ResumeAnalyzeResponse)
async def build_resume(
    request: ResumeBuildRequest,
    actor: SecurityActor = Depends(require_actor),
) -> ResumeAnalyzeResponse:
    return await resume_app_service.build(request, actor)


@router.post("/resume/download")
def download_resume(
    request: ResumeDownloadRequest,
    actor: SecurityActor = Depends(require_actor),
) -> Response:
    filename, resume_text = resume_app_service.download(request, actor)
    return Response(
        content=resume_text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
