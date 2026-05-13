import asyncio
import logging
import os

from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import sarvam

load_dotenv()

logger = logging.getLogger("saarthi-live-agent")
logger.setLevel(logging.INFO)

silence_check_seconds = float(os.getenv("SILENCE_CHECK_SECONDS", "8"))
max_idle_prompts = int(os.getenv("MAX_IDLE_PROMPTS", "2"))
enable_idle_prompts = os.getenv("ENABLE_IDLE_PROMPTS", "false").lower() == "true"


class SaarthiVoiceAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="""
                You are Saarthi Live, a multilingual discussion agent for Indian users.
                Keep responses short, warm, and practical.
                The user may speak any Indian language. Detect and understand it naturally.
                Reply in the same language as the user's latest message.
                If the user asks for translation or a different output language, follow that request.
                Ask one focused question at a time.
                Do not claim that the session is recorded.
                Silence and cost-control policy:
                - If the user is silent, wait first. Do not repeat the same question immediately.
                - Do not proactively ask silence follow-up questions unless runtime idle prompts are enabled.
                - If runtime asks you to stop, say one short closing sentence and stop.
                - Never loop follow-up questions endlessly.
            """,
            stt=sarvam.STT(
                language="unknown",
                model="saaras:v3",
                mode="transcribe",
                flush_signal=True,
            ),
            llm=sarvam.LLM(
                model=os.getenv("SARVAM_LLM_MODEL", "sarvam-m"),
                reasoning_effort=None,
                temperature=0.2,
                max_tokens=700,
            ),
            tts=sarvam.TTS(
                target_language_code=os.getenv("SARVAM_TTS_TARGET_LANGUAGE", "hi-IN"),
                model="bulbul:v3",
                speaker=os.getenv("SARVAM_TTS_SPEAKER", "anand"),
            ),
        )

    async def on_enter(self) -> None:
        self.session.generate_reply()


def install_idle_policy(session: AgentSession) -> None:
    if not enable_idle_prompts:
        logger.info("idle prompts disabled; cost guard is active")
        return

    state: dict[str, asyncio.Task | int | bool] = {
        "task": None,
        "attempts": 0,
        "closed": False,
    }

    def cancel_idle_task() -> None:
        task = state.get("task")
        if isinstance(task, asyncio.Task) and not task.done():
            task.cancel()
        state["task"] = None

    async def idle_check(expected_attempts: int) -> None:
        try:
            await asyncio.sleep(silence_check_seconds)

            if state["closed"] or session.agent_state != "idle":
                return

            if session.user_state in ("speaking", "listening"):
                return

            if expected_attempts >= max_idle_prompts:
                state["closed"] = True
                session.generate_reply(
                    instructions=(
                        "The user has not responded after the allowed silence checks. "
                        "Say briefly that you are stopping the session to avoid extra cost."
                    )
                )
                await asyncio.sleep(3)
                session.shutdown(drain=True)
                return

            next_attempt = expected_attempts + 1
            state["attempts"] = next_attempt
            session.generate_reply(
                instructions=(
                    "The user has been silent. Ask one short, gentle check-in question. "
                    "Do not repeat the previous question word-for-word. "
                    f"This is silence check {next_attempt} of {max_idle_prompts}."
                )
            )
        except asyncio.CancelledError:
            return

    def schedule_idle_check() -> None:
        cancel_idle_task()

        if state["closed"] or session.agent_state != "idle":
            return

        state["task"] = asyncio.create_task(idle_check(int(state["attempts"])))

    def on_agent_state_changed(event) -> None:
        if event.new_state == "idle":
            schedule_idle_check()
        else:
            cancel_idle_task()

    def on_user_state_changed(event) -> None:
        if event.new_state in ("speaking", "listening"):
            state["attempts"] = 0
            cancel_idle_task()
        elif event.new_state == "away" and session.agent_state == "idle":
            schedule_idle_check()

    def on_conversation_item_added(event) -> None:
        if getattr(event.item, "role", None) == "user":
            state["attempts"] = 0
            cancel_idle_task()

    session.on("agent_state_changed", on_agent_state_changed)
    session.on("user_state_changed", on_user_state_changed)
    session.on("conversation_item_added", on_conversation_item_added)


async def entrypoint(ctx: JobContext) -> None:
    logger.info("User connected to room: %s", ctx.room.name)

    session = AgentSession(
        turn_detection="stt",
        min_endpointing_delay=0.07,
    )
    install_idle_policy(session)
    await session.start(
        agent=SaarthiVoiceAgent(),
        room=ctx.room,
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
