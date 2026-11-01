"""
Small LLM provider abstraction.

Provider is selected from the environment (never hardcoded):

  LLM_PROVIDER = gemini | groq | openai

Keys (first match wins if LLM_PROVIDER is unset):

  GEMINI_API_KEY or GOOGLE_API_KEY
  GROQ_API_KEY
  OPENAI_API_KEY

Optional:

  LLM_MODEL   — override the default model for the chosen provider
  LLM_API_KEY — generic key used with LLM_PROVIDER

If no key is configured, callers must use deterministic fallbacks.
Secrets are never logged.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import httpx
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0)

_DEFAULT_MODELS = {
    "gemini": "gemini-2.0-flash",
    "groq": "llama-3.1-8b-instant",
    "openai": "gpt-4o-mini",
}


class LLMNotConfigured(RuntimeError):
    pass


def configured_provider() -> Optional[str]:
    explicit = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if explicit in {"none", "off", "disabled"}:
        return None
    if explicit in _DEFAULT_MODELS:
        if _api_key_for(explicit):
            return explicit
        return None
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return "gemini"
    if os.getenv("GROQ_API_KEY"):
        return "groq"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return None


def is_configured() -> bool:
    return configured_provider() is not None


def _api_key_for(provider: str) -> Optional[str]:
    generic = os.getenv("LLM_API_KEY")
    if provider == "gemini":
        return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or generic
    if provider == "groq":
        return os.getenv("GROQ_API_KEY") or generic
    if provider == "openai":
        return os.getenv("OPENAI_API_KEY") or generic
    return generic


def _model_for(provider: str) -> str:
    return (os.getenv("LLM_MODEL") or "").strip() or _DEFAULT_MODELS[provider]


def _extract_json_object(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("No JSON object in model output")
    return json.loads(text[start : end + 1])


async def complete_json(system: str, user: str) -> dict:
    """Ask the configured provider for a JSON object."""
    raw = await complete_text(system, user, json_mode=True)
    return _extract_json_object(raw)


async def complete_text(system: str, user: str, json_mode: bool = False) -> str:
    provider = configured_provider()
    if provider is None:
        raise LLMNotConfigured("No LLM provider is configured")

    key = _api_key_for(provider)
    if not key:
        raise LLMNotConfigured("No LLM API key is configured")

    model = _model_for(provider)
    logger.info("LLM request provider=%s model=%s json_mode=%s", provider, model, json_mode)

    if provider == "gemini":
        return await _gemini_complete(key, model, system, user, json_mode)
    return await _openai_compatible_complete(provider, key, model, system, user, json_mode)


async def _gemini_complete(
    key: str, model: str, system: str, user: str, json_mode: bool
) -> str:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    )
    generation_config: dict = {"temperature": 0.2}
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": generation_config,
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.post(url, params={"key": key}, json=payload)
    except httpx.RequestError as exc:
        logger.error("Gemini request failed: %s", exc)
        raise RuntimeError("Language model request failed.") from exc

    if response.status_code != 200:
        logger.error("Gemini HTTP %s", response.status_code)
        raise RuntimeError("Language model returned an unexpected status.")

    data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Language model returned an unexpected payload.") from exc


async def _openai_compatible_complete(
    provider: str, key: str, model: str, system: str, user: str, json_mode: bool
) -> str:
    if provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
    else:
        url = "https://api.openai.com/v1/chat/completions"

    body: dict = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body,
            )
    except httpx.RequestError as exc:
        logger.error("%s request failed: %s", provider, exc)
        raise RuntimeError("Language model request failed.") from exc

    if response.status_code != 200:
        logger.error("%s HTTP %s", provider, response.status_code)
        raise RuntimeError("Language model returned an unexpected status.")

    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Language model returned an unexpected payload.") from exc
