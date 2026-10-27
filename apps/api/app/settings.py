from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


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


settings = Settings()
