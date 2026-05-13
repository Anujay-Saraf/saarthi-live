from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SessionMode(str, Enum):
    GENERAL = "general"
    INTERVIEW = "interview"


class InterviewStage(str, Enum):
    RESUME_LOADED = "resume_loaded"
    INTERVIEW_STARTED = "interview_started"
    FOLLOWUP_QUESTION = "followup_question"
    PROFILE_SIGNAL_UPDATE = "profile_signal_update"
    CLOSE_SESSION = "close_session"


class SecurityActor(BaseModel):
    session_id: str = "anonymous"
    tenant_id: str = "default"
    role: str = "user"


class ConversationTurn(BaseModel):
    role: str
    content: str


class ConversationState(BaseModel):
    transcript: str
    detected_language: str | None = None
    reply_language: str = "en-IN"
    mode: SessionMode = SessionMode.GENERAL
    history: list[ConversationTurn] = Field(default_factory=list)
    resume_context: str = ""
    active_context: str = ""
    short_acknowledgement: bool = False
    safety_notes: list[str] = Field(default_factory=list)
    actor: SecurityActor = Field(default_factory=SecurityActor)
    interview_stage: InterviewStage | None = None


class ConversationDecision(BaseModel):
    mode: SessionMode
    stage: InterviewStage | None = None
    graph_path: list[str] = Field(default_factory=list)
    system_contract: str
    prompt: str
    max_tokens: int = 160
    temperature: float = 0.2
    safety_notes: list[str] = Field(default_factory=list)


class ResumeProfile(BaseModel):
    role: str
    summary: str
    skills: list[str]
    experience: str
    interview_brief: str
    resume_text: str
    resume_text_hi: str = ""
    resume_text_en: str = ""
    source_note: str = ""


class ResumeBuildDetails(BaseModel):
    name: str = ""
    work_type: str = ""
    location: str = ""
    experience: str = ""
    skills: str = ""
    projects: str = ""
    languages: str = ""
    extra_notes: str = ""


class CandidatePersona(BaseModel):
    confidence: str
    emotional_state: str
    stress_signal: str
    understanding_depth: str
    strengths: list[str]
    weaknesses: list[str]
    interviewer_notes: str
    next_deep_questions: list[str]


class AuditEvent(BaseModel):
    event_type: str
    endpoint: str
    actor: SecurityActor
    metadata: dict[str, Any] = Field(default_factory=dict)
