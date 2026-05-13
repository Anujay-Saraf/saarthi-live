import os
from typing import Any, Callable

import httpx
from fastapi import HTTPException, UploadFile

from security import ALLOWED_AUDIO_EXTENSIONS, basic_malware_screen, validate_upload_metadata, validate_upload_size


LogFn = Callable[[str], None]


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing {name}")
    return value


async def speech_to_text(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    safe_log: LogFn,
) -> tuple[str, str | None]:
    sarvam_key = require_env("SARVAM_API_KEY")
    safe_log(f"STT upload filename={filename} content_type={content_type} bytes={len(content)}")

    if len(content) < 1024:
        raise HTTPException(
            status_code=400,
            detail="No usable audio was captured. Tap Start Listening, speak for 2-5 seconds, then tap Stop.",
        )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=20)) as client:
            response = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": sarvam_key},
                data={
                    "model": "saaras:v3",
                    "mode": "transcribe",
                    "language_code": "unknown",
                },
                files={"file": (filename, content, content_type)},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="Sarvam STT timed out. Please try a shorter voice turn, around 5 to 10 seconds.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Sarvam STT. Please try again.") from exc

    if response.status_code >= 400:
        safe_log(f"Sarvam STT rejected status={response.status_code} body={response.text[:500]}")
        if "duration exceeds" in response.text.lower() or "maximum limit of 30 seconds" in response.text.lower():
            raise HTTPException(
                status_code=400,
                detail="That voice turn was too long for Sarvam live STT. Please pause sooner; the app will now keep turns under the live STT limit.",
            )
        raise HTTPException(status_code=502, detail=f"Sarvam STT failed: {response.text[:300]}")

    payload = response.json()
    return payload.get("transcript", "").strip(), payload.get("language_code")


async def chat_completion(
    *,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> str:
    sarvam_key = require_env("SARVAM_API_KEY")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.sarvam.ai/v1/chat/completions",
            headers={
                "api-subscription-key": sarvam_key,
                "Content-Type": "application/json",
            },
            json={
                "model": os.getenv("SARVAM_LLM_MODEL", "sarvam-m"),
                "messages": messages,
                "reasoning_effort": None,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "n": 1,
            },
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Sarvam chat failed: {response.text[:300]}")

    payload: dict[str, Any] = response.json()
    return payload["choices"][0]["message"]["content"]


async def text_to_speech(
    *,
    text: str,
    language_code: str,
) -> tuple[bytes, str]:
    sarvam_key = require_env("SARVAM_API_KEY")
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15)) as client:
        response = await client.post(
            "https://api.sarvam.ai/text-to-speech/stream",
            headers={
                "api-subscription-key": sarvam_key,
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "target_language_code": language_code,
                "speaker": os.getenv("SARVAM_TTS_SPEAKER", "anand").strip().lower() or "anand",
                "model": "bulbul:v3",
                "pace": 1,
                "temperature": 0.6,
                "output_audio_codec": "mp3",
                "output_audio_bitrate": "64k",
            },
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Sarvam TTS failed: {response.text[:300]}")

    return response.content, response.headers.get("content-type", "audio/mpeg")


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


class SarvamLLMService:
    async def complete(self, messages: list[dict[str, str]], max_tokens: int, temperature: float) -> str:
        return await chat_completion(messages=messages, max_tokens=max_tokens, temperature=temperature)


class SarvamSpeechToTextService:
    def __init__(self, safe_log: LogFn) -> None:
        self.safe_log = safe_log

    async def transcribe_upload(self, file: UploadFile) -> tuple[str, str | None]:
        validate_upload_metadata(file, ALLOWED_AUDIO_EXTENSIONS, "audio")
        content = await file.read()
        validate_upload_size(content, "Audio")
        basic_malware_screen(content, "Audio")
        filename, content_type = normalize_audio_upload(file.filename, file.content_type)
        return await speech_to_text(
            content=content,
            filename=filename,
            content_type=content_type,
            safe_log=self.safe_log,
        )


class SarvamTextToSpeechService:
    async def synthesize(self, text: str, language_code: str) -> tuple[bytes, str]:
        return await text_to_speech(text=text, language_code=language_code)
