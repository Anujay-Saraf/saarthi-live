"""Conversation orchestration boundary.

This module connects speech transcription, conversation graph decisions,
Sarvam-m chat completion, and final reply cleanup without depending on FastAPI
route details.
"""

from fastapi import UploadFile

from schemas import SecurityActor
from services.interfaces import LLMService, SpeechToTextService
from token_server import (
    ConversationState,
    ConversationTurn,
    SecurityActor as DefaultSecurityActor,
    SessionMode,
    active_context_brief,
    clean_llm_reply,
    compact_context_text,
    compact_history,
    decide_conversation,
    is_short_acknowledgement,
    language_name,
    redact_pii,
    reply_language_for_turn,
    safe_log,
)
from security import sanitize_untrusted_text


class AgentOrchestrator:
    def __init__(self, llm: LLMService, stt: SpeechToTextService) -> None:
        self.llm = llm
        self.stt = stt

    async def transcribe(self, file: UploadFile) -> tuple[str, str | None]:
        transcript, detected_language = await self.stt.transcribe_upload(file)
        safe_log(f"STT transcript={redact_pii(transcript, 180)!r} detected_language={detected_language!r}")
        return transcript, detected_language

    async def reply(
        self,
        transcript: str,
        language_code: str | None,
        history_json: str | None,
        profile_context: str | None,
        mode: str,
        actor: SecurityActor | None = None,
    ) -> str:
        reply_language = reply_language_for_turn(transcript, language_code)
        history_messages = compact_history(history_json)
        compact_profile_context, security_notes = sanitize_untrusted_text(
            compact_context_text(profile_context),
            max_chars=6500,
        )
        active_brief = active_context_brief(history_messages, profile_context)
        graph_state = ConversationState(
            transcript=transcript,
            detected_language=language_code,
            reply_language=reply_language,
            mode=SessionMode.INTERVIEW if mode.strip().lower() == "interview" else SessionMode.GENERAL,
            history=[ConversationTurn(**message) for message in history_messages],
            resume_context=compact_profile_context,
            active_context=active_brief,
            short_acknowledgement=is_short_acknowledgement(transcript),
            safety_notes=security_notes,
            actor=actor or DefaultSecurityActor(),
        )
        decision = decide_conversation(graph_state, language_name)
        messages = [{"role": "user", "content": decision.prompt}]
        safe_log(f"Chat message roles={[message['role'] for message in messages]} reply_language={reply_language}")
        raw_reply = await self.llm.complete(
            messages=messages,
            max_tokens=decision.max_tokens,
            temperature=decision.temperature,
        )
        clean_reply = clean_llm_reply(raw_reply, reply_language, transcript)
        safe_log(f"LLM raw={raw_reply[:180]!r} clean={clean_reply[:180]!r}")
        return clean_reply
