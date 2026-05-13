"""Application use-case services for Saarthi Live.

FastAPI route modules call these classes instead of holding business logic.
Each service coordinates the agent/orchestration layer, provider interfaces,
security/audit adapters, and response models for one product workflow.
"""

import re

from fastapi import HTTPException, UploadFile
from livekit import api

from pydantic_agents import CandidateProfileAgent, ResumeAnalyzerAgent, ResumeBuilderAgent
from schemas import ResumeBuildDetails, SecurityActor
from security import redact_pii, sanitize_untrusted_text
from services.agent_orchestrator import AgentOrchestrator
from services.document_parser import LocalDocumentParserService
from services.governance import DefaultUploadSecurityService, SecurityAuditService
from services.interfaces import AuditService, DocumentParserService, LLMService, TextToSpeechService, UploadSecurityService
from services.sarvam import SarvamLLMService, SarvamSpeechToTextService, SarvamTextToSpeechService, require_env
from token_server import (
    CandidateProfileRequest,
    CandidateProfileResponse,
    ResumeAnalyzeResponse,
    ResumeBuildRequest,
    ResumeDownloadRequest,
    TextTurnRequest,
    TokenRequest,
    TokenResponse,
    VoiceTurnResponse,
    candidate_persona_to_response,
    candidate_profile_fallback,
    candidate_response_to_persona,
    clean_llm_reply,
    coerce_tts_language,
    compact_context_text,
    graph_available,
    infer_language_from_text,
    profile_from_text,
    reply_language_for_turn,
    resume_profile_to_response,
    resume_response_to_profile,
    safe_log,
    transcript_guard_reason,
)


class VoiceApplicationService:
    def __init__(self, orchestrator: AgentOrchestrator, audit_service: AuditService) -> None:
        self.orchestrator = orchestrator
        self.audit = audit_service

    async def transcribe_speech(self, file: UploadFile, actor: SecurityActor) -> dict[str, str | None]:
        transcript, language_code = await self.orchestrator.transcribe(file)
        self.audit.record(
            "/speech/transcribe",
            actor,
            "speech_transcribed",
            {"language": language_code or "unknown", "transcript_chars": len(transcript)},
        )
        return {
            "transcript": transcript,
            "detected_language": language_code,
            "reply_language": reply_language_for_turn(transcript, language_code),
        }

    async def text_turn(self, request: TextTurnRequest, actor: SecurityActor) -> VoiceTurnResponse:
        transcript, safety_notes = sanitize_untrusted_text(request.text, max_chars=2500)
        language_code = request.language_code or infer_language_from_text(transcript) or "unknown"
        reply_language = reply_language_for_turn(transcript, language_code)

        if not transcript:
            return VoiceTurnResponse(
                transcript="",
                detected_language=language_code,
                reply_language=reply_language,
                reply="I could not hear that clearly. Please try again with a short sentence.",
            )

        reply = await self.orchestrator.reply(
            transcript,
            language_code,
            request.history,
            request.context,
            request.mode,
            actor,
        )
        self.audit.record(
            "/text-turn",
            actor,
            "conversation_turn",
            {"mode": request.mode, "language": language_code, "chars": len(transcript), "safety": safety_notes},
        )
        return VoiceTurnResponse(
            transcript=transcript,
            detected_language=language_code,
            reply_language=reply_language,
            reply=reply,
        )

    async def voice_turn(
        self,
        file: UploadFile,
        history: str | None,
        context: str | None,
        mode: str,
        actor: SecurityActor,
    ) -> VoiceTurnResponse:
        transcript, language_code = await self.orchestrator.transcribe(file)
        reply_language = reply_language_for_turn(transcript, language_code)
        guard_reason = transcript_guard_reason(transcript, language_code, history)
        if guard_reason:
            safe_log(f"Ignoring suspicious transcript reason={guard_reason} transcript={redact_pii(transcript, 180)!r}")
            self.audit.record("/voice-turn", actor, "voice_turn_ignored", {"reason": guard_reason, "language": language_code})
            return VoiceTurnResponse(
                transcript="",
                detected_language=language_code,
                reply_language=reply_language,
                reply="I heard some unclear repeated audio. Please say that once again.",
                ignored=True,
                reason=guard_reason,
            )

        if not transcript:
            return VoiceTurnResponse(
                transcript="",
                detected_language=language_code,
                reply_language=reply_language,
                reply="I could not hear that clearly. Please try again with a short sentence.",
            )

        reply = await self.orchestrator.reply(transcript, language_code, history, context, mode, actor)
        self.audit.record(
            "/voice-turn",
            actor,
            "conversation_turn",
            {"mode": mode, "language": language_code or "unknown", "transcript_chars": len(transcript)},
        )
        return VoiceTurnResponse(
            transcript=transcript,
            detected_language=language_code,
            reply_language=reply_language,
            reply=reply,
        )


class ResumeApplicationService:
    def __init__(
        self,
        llm: LLMService,
        document_parser: DocumentParserService,
        upload_security: UploadSecurityService,
        audit_service: AuditService,
    ) -> None:
        self.llm = llm
        self.document_parser = document_parser
        self.upload_security = upload_security
        self.audit = audit_service

    async def analyze(
        self,
        file: UploadFile | None,
        text: str | None,
        actor: SecurityActor,
    ) -> ResumeAnalyzeResponse:
        source_note = "Text pasted by user."
        resume_text, text_notes = sanitize_untrusted_text(text or "", max_chars=7000)

        if file is not None:
            content = await file.read()
            self.upload_security.validate_resume_upload(file, content)
            extracted_text, source_note = self.document_parser.extract_text(file.filename or "resume", file.content_type, content)
            extracted_text, file_notes = sanitize_untrusted_text(extracted_text, max_chars=7000)
            text_notes.extend(file_notes)
            resume_text = "\n".join(part for part in [resume_text, extracted_text] if part).strip()

        if not resume_text:
            return profile_from_text("", source_note)

        try:
            raw = await self.llm.complete(
                messages=[{"role": "user", "content": ResumeAnalyzerAgent.prompt(resume_text)}],
                max_tokens=420,
                temperature=0.2,
            )
            fallback = profile_from_text(resume_text, source_note)
            profile = ResumeAnalyzerAgent.parse(raw, resume_response_to_profile(fallback), resume_text, source_note)
            result = resume_profile_to_response(profile)
            self.audit.record(
                "/resume/analyze",
                actor,
                "resume_analyzed",
                {"source": source_note, "chars": len(resume_text), "role": result.role, "safety": text_notes},
            )
            return result
        except Exception as exc:
            safe_log(f"Resume analyze exception={exc}")
            return profile_from_text(resume_text, source_note)

    async def build(self, request: ResumeBuildRequest, actor: SecurityActor) -> ResumeAnalyzeResponse:
        clean_fields = {
            "name": sanitize_untrusted_text(request.name, 300)[0],
            "work_type": sanitize_untrusted_text(request.work_type, 300)[0],
            "location": sanitize_untrusted_text(request.location, 300)[0],
            "experience": sanitize_untrusted_text(request.experience, 900)[0],
            "skills": sanitize_untrusted_text(request.skills, 900)[0],
            "projects": sanitize_untrusted_text(request.projects, 1200)[0],
            "languages": sanitize_untrusted_text(request.languages, 500)[0],
            "extra_notes": sanitize_untrusted_text(request.extra_notes, 1200)[0],
        }
        details = ResumeBuildDetails(**clean_fields)

        try:
            raw = await self.llm.complete(
                messages=[{"role": "user", "content": ResumeBuilderAgent.prompt(details)}],
                max_tokens=700,
                temperature=0.2,
            )
            fallback_text = "\n".join(value for value in clean_fields.values() if value)
            fallback = profile_from_text(fallback_text, "AI resume builder.")
            profile = ResumeBuilderAgent.parse(raw, resume_response_to_profile(fallback), details)
            result = resume_profile_to_response(profile)
            self.audit.record(
                "/resume/build",
                actor,
                "resume_built",
                {"role": result.role, "fields": [key for key, value in clean_fields.items() if value]},
            )
            return result
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Resume build failed: {exc}") from exc

    def download(self, request: ResumeDownloadRequest, actor: SecurityActor) -> tuple[str, str]:
        filename = re.sub(r"[^A-Za-z0-9_.-]", "_", request.filename or "resume.txt")
        if not filename.lower().endswith(".txt"):
            filename = f"{filename}.txt"
        resume_text, _ = sanitize_untrusted_text(request.resume_text, max_chars=12000)
        self.audit.record("/resume/download", actor, "resume_downloaded", {"filename": filename, "chars": len(resume_text)})
        return filename, resume_text


class ProfileApplicationService:
    def __init__(self, llm: LLMService, audit_service: AuditService) -> None:
        self.llm = llm
        self.audit = audit_service

    async def build_candidate_profile(
        self,
        request: CandidateProfileRequest,
        actor: SecurityActor,
    ) -> CandidateProfileResponse:
        clean_messages = []
        for message in request.messages[-24:]:
            role = message.get("role")
            content, _ = sanitize_untrusted_text(str(message.get("content", "")).strip(), max_chars=900)
            if role in {"user", "assistant"} and content:
                clean_messages.append({"role": role, "content": content[:900]})

        if len([message for message in clean_messages if message["role"] == "user"]) < 4:
            return candidate_profile_fallback(clean_messages, request.resume_context)

        safe_resume_context = sanitize_untrusted_text(compact_context_text(request.resume_context, 3500), 3500)[0]
        try:
            raw = await self.llm.complete(
                messages=[{"role": "user", "content": CandidateProfileAgent.prompt(clean_messages, safe_resume_context)}],
                max_tokens=520,
                temperature=0.2,
            )
            fallback = candidate_profile_fallback(clean_messages, request.resume_context)
            persona = CandidateProfileAgent.parse(raw, candidate_response_to_persona(fallback))
            result = candidate_persona_to_response(persona)
            self.audit.record(
                "/candidate/profile",
                actor,
                "candidate_profile_generated",
                {"turns": len(clean_messages), "user_turns": len([m for m in clean_messages if m["role"] == "user"])},
            )
            return result
        except Exception as exc:
            safe_log(f"Candidate profile exception={exc}")
            return candidate_profile_fallback(clean_messages, request.resume_context)


class SystemApplicationService:
    def __init__(self, tts: TextToSpeechService, audit_service: AuditService) -> None:
        self.tts = tts
        self.audit = audit_service

    def health(self) -> dict[str, str]:
        import os

        return {
            "status": "ok",
            "graph": "langgraph" if graph_available() else "pydantic-fallback",
            "auth": "enabled" if os.getenv("SAARTHI_API_TOKEN", "").strip() else "dev-open",
        }

    async def tts_audio(self, text: str, language_code: str | None, actor: SecurityActor) -> tuple[bytes, str]:
        tts_language = coerce_tts_language(language_code)
        clean_text = clean_llm_reply(text, tts_language)
        if not clean_text:
            raise HTTPException(status_code=400, detail="Text is required for TTS.")
        self.audit.record("/tts", actor, "tts_requested", {"language": tts_language, "chars": len(clean_text)})
        return await self.tts.synthesize(clean_text, tts_language)


class LiveKitTokenApplicationService:
    def __init__(self, audit_service: AuditService) -> None:
        self.audit = audit_service

    def create_token(self, request: TokenRequest, actor: SecurityActor) -> TokenResponse:
        livekit_url = require_env("LIVEKIT_URL")
        livekit_api_key = require_env("LIVEKIT_API_KEY")
        livekit_api_secret = require_env("LIVEKIT_API_SECRET")

        room = re.sub(r"[^A-Za-z0-9_.:-]", "-", request.room).strip("-")[:96] or "saarthi-live-demo"
        identity = re.sub(r"[^A-Za-z0-9_.:@-]", "-", request.identity).strip("-")[:96] or actor.session_id
        name = re.sub(r"[\r\n\t]", " ", request.name).strip()[:80] or "Guest"
        from livekit import api

        token = (
            api.AccessToken(livekit_api_key, livekit_api_secret)
            .with_identity(identity)
            .with_name(name)
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room,
                    can_publish=True,
                    can_subscribe=True,
                )
            )
            .to_jwt()
        )
        self.audit.record("/token", actor, "livekit_token_issued", {"room": room, "identity": identity})
        return TokenResponse(url=livekit_url, token=token, room=room, identity=identity)


audit_service = SecurityAuditService()
llm_service = SarvamLLMService()
stt_service = SarvamSpeechToTextService(safe_log)
tts_service = SarvamTextToSpeechService()
document_parser_service = LocalDocumentParserService()
upload_security_service = DefaultUploadSecurityService()
agent_orchestrator = AgentOrchestrator(llm_service, stt_service)

voice_app_service = VoiceApplicationService(agent_orchestrator, audit_service)
resume_app_service = ResumeApplicationService(
    llm_service,
    document_parser_service,
    upload_security_service,
    audit_service,
)
profile_app_service = ProfileApplicationService(llm_service, audit_service)
system_app_service = SystemApplicationService(tts_service, audit_service)
livekit_token_app_service = LiveKitTokenApplicationService(audit_service)
