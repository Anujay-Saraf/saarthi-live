import os
import json
import re
import io
import math
import struct
import wave
from uuid import uuid4

from conversation_graph import decide_conversation, graph_available
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from schemas import CandidatePersona, ConversationState, ConversationTurn, ResumeProfile, SecurityActor, SessionMode
from services import document_parser, sarvam
from security import (
    ALLOWED_AUDIO_EXTENSIONS,
    basic_malware_screen,
    configured_cors_origins,
    redact_pii,
    sanitize_untrusted_text,
    validate_upload_metadata,
    validate_upload_size,
)

load_dotenv()

app = FastAPI(title="Saarthi Live Token Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_cors_origins(),
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class TokenRequest(BaseModel):
    identity: str = Field(default_factory=lambda: f"user-{uuid4().hex[:8]}")
    name: str = "Guest"
    room: str = "saarthi-live-demo"


class TokenResponse(BaseModel):
    url: str
    token: str
    room: str
    identity: str


class VoiceTurnResponse(BaseModel):
    transcript: str
    detected_language: str | None = None
    reply_language: str | None = None
    reply: str
    ignored: bool = False
    reason: str = ""


class TextTurnRequest(BaseModel):
    text: str
    history: str = ""
    context: str = ""
    mode: str = "general"
    language_code: str | None = None


class ResumeAnalyzeResponse(BaseModel):
    role: str
    summary: str
    skills: list[str]
    experience: str
    interview_brief: str
    resume_text: str
    resume_text_hi: str = ""
    resume_text_en: str = ""
    source_note: str = ""


class ResumeBuildRequest(BaseModel):
    name: str = ""
    work_type: str = ""
    location: str = ""
    experience: str = ""
    skills: str = ""
    projects: str = ""
    languages: str = ""
    extra_notes: str = ""


class ResumeDownloadRequest(BaseModel):
    resume_text: str
    filename: str = "resume.txt"


class CandidateProfileRequest(BaseModel):
    messages: list[dict[str, str]] = Field(default_factory=list)
    resume_context: str = ""


class CandidateProfileResponse(BaseModel):
    confidence: str
    emotional_state: str
    stress_signal: str
    understanding_depth: str
    strengths: list[str]
    weaknesses: list[str]
    interviewer_notes: str
    next_deep_questions: list[str]


def require_env(name: str) -> str:
    return sarvam.require_env(name)


def safe_log(message: str) -> None:
    try:
        print(message, flush=True)
    except UnicodeEncodeError:
        print(message.encode("unicode_escape").decode("ascii"), flush=True)


def compact_history(history_json: str | None) -> list[dict[str, str]]:
    if not history_json:
        return []

    try:
        raw_history = json.loads(history_json)
    except json.JSONDecodeError:
        return []

    if not isinstance(raw_history, list):
        return []

    valid_items: list[dict[str, str]] = []
    for item in raw_history[-16:]:
        if not isinstance(item, dict):
            continue

        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue

        clipped = content.strip()[:1200]
        if not clipped:
            continue

        if not valid_items and role != "user":
            continue

        if valid_items and valid_items[-1]["role"] == role:
            valid_items[-1]["content"] = f"{valid_items[-1]['content']}\n{clipped}"[:1200]
            continue

        valid_items.append({"role": role, "content": clipped})

    if valid_items and valid_items[-1]["role"] == "user":
        valid_items.pop()

    max_chars = int(os.getenv("MAX_CHAT_CONTEXT_CHARS", "6000"))
    compacted: list[dict[str, str]] = []
    remaining = max_chars

    for item in reversed(valid_items):
        remaining -= len(item["content"])
        if remaining < 0:
            break

        compacted.insert(0, item)

    return compacted


def compact_context_text(text: str | None, max_chars: int = 6500) -> str:
    if not text:
        return ""

    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= max_chars:
        return cleaned

    head = cleaned[: int(max_chars * 0.45)].strip()
    tail = cleaned[-int(max_chars * 0.45) :].strip()
    return f"{head}\n...[context compressed to save tokens]...\n{tail}"


def is_short_acknowledgement(text: str) -> bool:
    normalized = re.sub(r"[^a-zA-Z\u0900-\u097F ]", " ", text).lower()
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return False

    ack_phrases = {
        "ok",
        "okay",
        "thank you",
        "thanks",
        "theek hai",
        "ठीक है",
        "धन्यवाद",
        "शुक्रिया",
        "haan",
        "yes",
    }
    return normalized in ack_phrases or (len(normalized.split()) <= 4 and any(phrase in normalized for phrase in ack_phrases))


def active_context_brief(history_messages: list[dict[str, str]], profile_context: str | None = None) -> str:
    recent_user = [
        message["content"].strip()
        for message in history_messages
        if message.get("role") == "user" and message.get("content", "").strip()
    ][-3:]
    recent_assistant = [
        message["content"].strip()
        for message in history_messages
        if message.get("role") == "assistant" and message.get("content", "").strip()
    ][-2:]
    pieces = []
    if profile_context:
        role_match = re.search(r"Role:\s*([^\n]+)", profile_context)
        if role_match:
            pieces.append(f"Loaded role/context: {role_match.group(1).strip()}")
    if recent_user:
        pieces.append("Recent user focus: " + " | ".join(recent_user))
    if recent_assistant:
        pieces.append("Recent assistant direction: " + " | ".join(recent_assistant))
    return compact_context_text("\n".join(pieces), 1800)


def parse_json_object(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return {}

    return {}


def normalize_skills(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:12]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,;\n]", value) if item.strip()][:12]
    return []


def simple_role_guess(text: str) -> str:
    lowered = text.lower()
    role_markers = [
        ("plumber", "Plumber"),
        ("carpenter", "Carpenter"),
        ("teacher", "Tuition Teacher"),
        ("tutor", "Tuition Teacher"),
        ("content", "Content Creator"),
        ("video", "Content Creator"),
        ("ai engineer", "AI Engineer"),
        ("machine learning", "AI Engineer"),
        ("developer", "Software Developer"),
        ("driver", "Driver"),
        ("electrician", "Electrician"),
    ]
    for marker, role in role_markers:
        if marker in lowered:
            return role
    return "Candidate"


def extract_text_from_file(filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
    return document_parser.extract_text_from_file(filename, content_type, content)


def profile_from_text(text: str, source_note: str = "") -> ResumeAnalyzeResponse:
    compact = re.sub(r"\s+", " ", text).strip()
    role = simple_role_guess(compact)
    words = compact.split()
    summary = " ".join(words[:36]) if words else "No resume text found yet."
    skills = []
    for marker in ("plumbing", "carpentry", "teaching", "content creation", "video editing", "python", "machine learning", "customer service"):
        if marker in compact.lower():
            skills.append(marker.title())

    return ResumeAnalyzeResponse(
        role=role,
        summary=summary,
        skills=skills or ["Communication", "Work experience"],
        experience="Review the resume text for years and responsibilities.",
        interview_brief=f"Interview this person for a {role} role. Ask practical questions based on their real experience.",
        resume_text=compact[:7000],
        resume_text_hi="",
        resume_text_en=compact[:7000],
        source_note=source_note,
    )


def resume_response_to_profile(response: ResumeAnalyzeResponse) -> ResumeProfile:
    return ResumeProfile(
        role=response.role,
        summary=response.summary,
        skills=response.skills,
        experience=response.experience,
        interview_brief=response.interview_brief,
        resume_text=response.resume_text,
        resume_text_hi=response.resume_text_hi,
        resume_text_en=response.resume_text_en,
        source_note=response.source_note,
    )


def resume_profile_to_response(profile: ResumeProfile) -> ResumeAnalyzeResponse:
    return ResumeAnalyzeResponse(
        role=profile.role,
        summary=profile.summary,
        skills=profile.skills,
        experience=profile.experience,
        interview_brief=profile.interview_brief,
        resume_text=profile.resume_text,
        resume_text_hi=profile.resume_text_hi,
        resume_text_en=profile.resume_text_en,
        source_note=profile.source_note,
    )


def candidate_profile_fallback(messages: list[dict[str, str]], resume_context: str = "") -> CandidateProfileResponse:
    user_text = " ".join(
        str(message.get("content", "")) for message in messages if message.get("role") == "user"
    )
    lowered = user_text.lower()
    word_count = len(user_text.split())
    has_examples = any(marker in lowered for marker in ("project", "built", "handled", "created", "managed", "customer", "client"))
    uncertain = sum(lowered.count(marker) for marker in ("maybe", "perhaps", "not sure", "i think", "shayad"))

    confidence = "Growing" if word_count > 180 and has_examples else "Needs more evidence"
    stress_signal = "Mild" if uncertain < 4 else "Noticeable"
    depth = "Practical examples visible" if has_examples else "Still surface-level"

    return CandidateProfileResponse(
        confidence=confidence,
        emotional_state="Engaged, still warming up",
        stress_signal=stress_signal,
        understanding_depth=depth,
        strengths=["Communication willingness", "Role clarity from conversation" if resume_context else "Open to guided questioning"],
        weaknesses=["Needs more concrete metrics", "Needs deeper examples before final assessment"],
        interviewer_notes="Continue with short, specific follow-ups. Ask for real examples, decisions, tools used, outcomes, and mistakes handled.",
        next_deep_questions=[
            "Tell me one real project or work case from start to finish.",
            "What was the hardest part, and what exactly did you do?",
            "How can I verify the outcome or quality of that work?",
        ],
    )


def candidate_response_to_persona(response: CandidateProfileResponse) -> CandidatePersona:
    return CandidatePersona(
        confidence=response.confidence,
        emotional_state=response.emotional_state,
        stress_signal=response.stress_signal,
        understanding_depth=response.understanding_depth,
        strengths=response.strengths,
        weaknesses=response.weaknesses,
        interviewer_notes=response.interviewer_notes,
        next_deep_questions=response.next_deep_questions,
    )


def candidate_persona_to_response(persona: CandidatePersona) -> CandidateProfileResponse:
    return CandidateProfileResponse(
        confidence=persona.confidence,
        emotional_state=persona.emotional_state,
        stress_signal=persona.stress_signal,
        understanding_depth=persona.understanding_depth,
        strengths=persona.strengths,
        weaknesses=persona.weaknesses,
        interviewer_notes=persona.interviewer_notes,
        next_deep_questions=persona.next_deep_questions,
    )


def make_handoff_tone() -> bytes:
    sample_rate = 22050
    duration = 1.15
    frames = int(sample_rate * duration)
    output = io.BytesIO()

    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        for index in range(frames):
            t = index / sample_rate
            fade_in = min(1.0, t / 0.18)
            fade_out = min(1.0, (duration - t) / 0.35)
            envelope = min(fade_in, fade_out) * 0.26
            tone = math.sin(2 * math.pi * 440 * t) + 0.55 * math.sin(2 * math.pi * 660 * t)
            sample = int(max(-1, min(1, tone * envelope)) * 32767)
            wav.writeframes(struct.pack("<h", sample))

    return output.getvalue()


def normalize_audio_upload(filename: str | None, content_type: str | None) -> tuple[str, str]:
    clean_name = filename or "voice-turn.m4a"
    clean_type = (content_type or "").split(";")[0].strip().lower()

    if clean_type in {"audio/m4a", "audio/x-m4a"}:
        return clean_name, "audio/x-m4a"
    if clean_type == "audio/aac":
        return clean_name, "audio/aac"

    if clean_type in {"audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/webm"}:
        return clean_name, clean_type

    lower_name = clean_name.lower()
    if lower_name.endswith(".m4a"):
        return clean_name, "audio/x-m4a"
    if lower_name.endswith(".mp4"):
        return clean_name, "audio/mp4"
    if lower_name.endswith(".webm"):
        return clean_name, "audio/webm"
    if lower_name.endswith(".wav"):
        return clean_name, "audio/wav"
    if lower_name.endswith(".mp3"):
        return clean_name, "audio/mpeg"

    return clean_name, "audio/mp4"


def fallback_reply_for(language_code: str, transcript: str = "") -> str:
    normalized = transcript.lower()
    wants_interview = any(
        marker in normalized
        for marker in ("interview", "इंटरव्यू", "साक्षात्कार", "इंटर्व्यू")
    )

    if wants_interview:
        interview_fallbacks = {
            "hi-IN": "हाँ, बिल्कुल, मैं आपका एआई इंटरव्यू ले सकता हूँ। पहला सवाल: आपने कौन-सा एआई प्रोजेक्ट बनाया है और उसमें आपकी भूमिका क्या थी?",
            "gu-IN": "હા, જરૂર, હું તમારો AI ઇન્ટરવ્યુ લઈ શકું છું. પહેલો પ્રશ્ન: તમે કયો AI પ્રોજેક્ટ બનાવ્યો અને તેમાં તમારી ભૂમિકા શું હતી?",
            "pa-IN": "ਹਾਂ, ਬਿਲਕੁਲ, ਮੈਂ ਤੁਹਾਡਾ AI ਇੰਟਰਵਿਊ ਲੈ ਸਕਦਾ ਹਾਂ। ਪਹਿਲਾ ਸਵਾਲ: ਤੁਸੀਂ ਕਿਹੜਾ AI ਪ੍ਰੋਜੈਕਟ ਬਣਾਇਆ ਅਤੇ ਤੁਹਾਡੀ ਭੂਮਿਕਾ ਕੀ ਸੀ?",
        }
        return interview_fallbacks.get(
            language_code,
            "Yes, absolutely. I can take your AI interview. First question: which AI project have you built, and what was your role in it?",
        )

    fallbacks = {
        "bn-IN": "আমি শুনতে পাচ্ছি। কীভাবে সাহায্য করতে পারি?",
        "gu-IN": "હું તમને સાંભળી શકું છું. હું કેવી રીતે મદદ કરું?",
        "hi-IN": "हाँ, मैं आपको सुन सकता हूँ। बताइए, मैं कैसे मदद करूँ?",
        "kn-IN": "ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        "ml-IN": "ഞാൻ കേൾക്കുന്നുണ്ട്. എങ്ങനെ സഹായിക്കാം?",
        "mr-IN": "हो, मी तुम्हाला ऐकू शकतो. कशी मदत करू?",
        "od-IN": "ମୁଁ ଶୁଣିପାରୁଛି। କିପରି ସହଯୋଗ କରିବି?",
        "pa-IN": "ਹਾਂ, ਮੈਂ ਤੁਹਾਨੂੰ ਸੁਣ ਸਕਦਾ ਹਾਂ। ਮੈਂ ਕਿਵੇਂ ਮਦਦ ਕਰਾਂ?",
        "ta-IN": "நான் கேட்கிறேன். எப்படி உதவலாம்?",
        "te-IN": "నేను వింటున్నాను. ఎలా సహాయం చేయగలను?",
    }
    return fallbacks.get(language_code, "I can hear you. Please tell me how I can help.")


def clean_llm_reply(raw_reply: str, reply_language: str = "en-IN", transcript: str = "") -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", raw_reply, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = cleaned.replace("</think>", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.strip('"“”')

    if not cleaned:
        cleaned = fallback_reply_for(reply_language, transcript)

    sentences = re.split(r"(?<=[.!?।])\s+", cleaned)
    short_reply = " ".join(sentences[:2]).strip()
    return short_reply[:320].strip()


def coerce_tts_language(language_code: str | None) -> str:
    normalized = (language_code or "").strip()
    supported = {
        "bn-IN",
        "en-IN",
        "gu-IN",
        "hi-IN",
        "kn-IN",
        "ml-IN",
        "mr-IN",
        "od-IN",
        "pa-IN",
        "ta-IN",
        "te-IN",
    }
    aliases = {
        "bn": "bn-IN",
        "en": "en-IN",
        "gu": "gu-IN",
        "hi": "hi-IN",
        "kn": "kn-IN",
        "ml": "ml-IN",
        "mr": "mr-IN",
        "od": "od-IN",
        "or": "od-IN",
        "pa": "pa-IN",
        "ta": "ta-IN",
        "te": "te-IN",
    }

    if normalized in supported:
        return normalized

    return aliases.get(normalized[:2].lower(), "hi-IN")


def language_name(language_code: str) -> str:
    names = {
        "bn-IN": "Bengali",
        "en-IN": "English",
        "gu-IN": "Gujarati",
        "hi-IN": "Hindi or Hinglish",
        "kn-IN": "Kannada",
        "ml-IN": "Malayalam",
        "mr-IN": "Marathi",
        "od-IN": "Odia",
        "pa-IN": "Punjabi",
        "ta-IN": "Tamil",
        "te-IN": "Telugu",
    }
    return names.get(language_code, language_code)


def looks_like_hinglish(text: str) -> bool:
    lowered = f" {text.lower()} "
    markers = {
        " main ",
        " maine ",
        " mera ",
        " meri ",
        " mere ",
        " mujhe ",
        " aap ",
        " apna ",
        " apne ",
        " kya ",
        " kaise ",
        " koshish ",
        " bacchon ",
        " bacho ",
        " padha ",
        " padhaya ",
        " unki ",
        " unke ",
        " mein ",
        " nahi ",
        " haan ",
        " theek ",
        " kar ",
        " kari ",
        " kiya ",
        " hua ",
        " tha ",
        " thi ",
        " samjha ",
        " bata ",
        " bataye ",
    }
    marker_count = sum(1 for marker in markers if marker in lowered)
    return marker_count >= 2 or any(phrase in lowered for phrase in ("kya aap", "maine koshish", "unki language", "bachon ko"))


def dominant_script_language(text: str) -> str | None:
    script_ranges = {
        "hi-IN": r"[\u0900-\u097F]",
        "bn-IN": r"[\u0980-\u09FF]",
        "pa-IN": r"[\u0A00-\u0A7F]",
        "gu-IN": r"[\u0A80-\u0AFF]",
        "od-IN": r"[\u0B00-\u0B7F]",
        "ta-IN": r"[\u0B80-\u0BFF]",
        "te-IN": r"[\u0C00-\u0C7F]",
        "kn-IN": r"[\u0C80-\u0CFF]",
        "ml-IN": r"[\u0D00-\u0D7F]",
    }
    counts = {language: len(re.findall(pattern, text)) for language, pattern in script_ranges.items()}
    language, count = max(counts.items(), key=lambda item: item[1])
    return language if count >= 4 else None


def repetitive_transcript_reason(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return ""

    words = cleaned.split()
    if len(words) >= 20:
        repeated_bigrams = sum(1 for index in range(len(words) - 2) if words[index : index + 2] == words[index + 2 : index + 4])
        if repeated_bigrams >= 5:
            return "repeated phrase artifact"

    if len(cleaned) > 180:
        units = re.findall(r"[\w\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0BFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]+", cleaned.lower())
        if units:
            most_common = max(set(units), key=units.count)
            if units.count(most_common) / len(units) > 0.38:
                return "repeated token artifact"

    return ""


def transcript_guard_reason(transcript: str, detected_language: str | None, history_json: str | None = None) -> str:
    repeat_reason = repetitive_transcript_reason(transcript)
    if repeat_reason:
        return repeat_reason

    history_messages = compact_history(history_json)
    recent_text = " ".join(message["content"] for message in history_messages[-6:])
    recent_language = dominant_script_language(recent_text)
    current_language = dominant_script_language(transcript)
    if recent_language and current_language and recent_language != current_language:
        normalized_detected = coerce_tts_language(detected_language)
        if normalized_detected == current_language and len(transcript) > 80:
            return f"unexpected language switch artifact: {recent_language} to {current_language}"

    return ""


def infer_language_from_text(text: str) -> str | None:
    script_map = [
        (r"[\u0A80-\u0AFF]", "gu-IN"),
        (r"[\u0A00-\u0A7F]", "pa-IN"),
        (r"[\u0980-\u09FF]", "bn-IN"),
        (r"[\u0B80-\u0BFF]", "ta-IN"),
        (r"[\u0C00-\u0C7F]", "te-IN"),
        (r"[\u0C80-\u0CFF]", "kn-IN"),
        (r"[\u0D00-\u0D7F]", "ml-IN"),
        (r"[\u0B00-\u0B7F]", "od-IN"),
        (r"[\u0900-\u097F]", "hi-IN"),
    ]

    for pattern, language_code in script_map:
        if re.search(pattern, text):
            return language_code

    if looks_like_hinglish(text):
        return "hi-IN"

    return None


def reply_language_for_turn(transcript: str, detected_language: str | None) -> str:
    normalized = (detected_language or "").strip().lower()
    script_language = infer_language_from_text(transcript)
    if normalized and normalized not in {"unknown", "und", "auto"}:
        detected = coerce_tts_language(detected_language)
        if detected == "en-IN" and script_language:
            return script_language
        return detected

    return script_language or "en-IN"


async def sarvam_speech_to_text(file: UploadFile) -> tuple[str, str | None]:
    validate_upload_metadata(file, ALLOWED_AUDIO_EXTENSIONS, "audio")
    content = await file.read()
    validate_upload_size(content, "Audio")
    basic_malware_screen(content, "Audio")
    filename, content_type = normalize_audio_upload(file.filename, file.content_type)
    transcript, detected_language = await sarvam.speech_to_text(
        content=content,
        filename=filename,
        content_type=content_type,
        safe_log=safe_log,
    )
    safe_log(f"STT transcript={redact_pii(transcript, 180)!r} detected_language={detected_language!r}")
    return transcript, detected_language


async def sarvam_chat(
    transcript: str,
    language_code: str | None,
    history_json: str | None,
    profile_context: str | None = None,
    mode: str = "general",
    actor: SecurityActor | None = None,
) -> str:
    reply_language = reply_language_for_turn(transcript, language_code)
    history_messages = compact_history(history_json)
    compact_profile_context, security_notes = sanitize_untrusted_text(
        compact_context_text(profile_context),
        max_chars=6500,
    )
    active_brief = active_context_brief(history_messages, profile_context)
    short_ack = is_short_acknowledgement(transcript)
    graph_state = ConversationState(
        transcript=transcript,
        detected_language=language_code,
        reply_language=reply_language,
        mode=SessionMode.INTERVIEW if mode.strip().lower() == "interview" else SessionMode.GENERAL,
        history=[ConversationTurn(**message) for message in history_messages],
        resume_context=compact_profile_context,
        active_context=active_brief,
        short_acknowledgement=short_ack,
        safety_notes=security_notes,
        actor=actor or SecurityActor(),
    )
    decision = decide_conversation(graph_state, language_name)
    prompt = decision.prompt
    messages = [
        {"role": "user", "content": prompt},
    ]
    safe_log(f"Chat message roles={[message['role'] for message in messages]} reply_language={reply_language}")

    raw_reply = await sarvam.chat_completion(
        messages=messages,
        max_tokens=decision.max_tokens,
        temperature=decision.temperature,
    )
    clean_reply = clean_llm_reply(raw_reply, reply_language, transcript)
    safe_log(f"LLM raw={raw_reply[:180]!r} clean={clean_reply[:180]!r}")
    return clean_reply


from api.routes_profile import router as profile_router
from api.routes_resume import router as resume_router
from api.routes_system import router as system_router
from api.routes_voice import router as voice_router


app.include_router(system_router)
app.include_router(voice_router)
app.include_router(profile_router)
app.include_router(resume_router)
