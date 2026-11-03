from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_HERE = Path(__file__).resolve()
# repo root when running from source (apps/api/app/settings.py); inside the Docker image the
# tree is shallower and there is no .env file, so fall back to the app directory.
ROOT = _HERE.parents[3] if len(_HERE.parents) > 3 else _HERE.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    groq_api_key: str = ""
    gemini_api_key: str = ""
    database_url: str = "postgresql://studio:studio@localhost:5433/studio"
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"
    code_sandbox: str = "auto"  # auto | docker | inprocess
    code_sandbox_memory: str = "256m"
    cors_origins: str = "http://localhost:3000"  # comma separated
    rate_limit_per_minute: int = 120  # per client IP, mutating requests
    daily_llm_call_budget: int = 2000  # 0 = unlimited; protects a public demo's free tier
    # Triggers: inbound webhooks are signed with this secret; empty disables them.
    webhook_secret: str = ""
    # Where this API is reachable from the internet (used to register the Telegram webhook).
    public_api_url: str = ""
    # Telegram approvals: a paused run is sent to this chat with Yes/No buttons.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


settings = Settings()
