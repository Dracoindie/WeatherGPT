"""
Follow-up questions: fill the slots a short reply leaves out from the
previous answer's context ("aur parso?", "what about Mumbai?").

Rules (only missing slots are filled; anything the user said wins):
- location: the caller resolves it from context coordinates when the message
  names no place and sends no GPS (see api/chat.py);
- date: inherited when the message is a follow-up and names no time;
- parameter: inherited when the message is a follow-up and names none;
- intent type: a follow-up to a climate / GFS answer stays climate / GFS
  unless it asks for something else.
"""

from __future__ import annotations

import re

from llm.query_parser import is_climate_query, is_nwp_query
from models.chat import ChatContext, ChatIntent

_FOLLOW_UP_START = re.compile(
    r"^\s*(and|aur|or|what about|how about|and what about|then|phir|toh|to|also|same for|ani|आणि)\b",
    re.IGNORECASE,
)
_DEVANAGARI_START = ("और", "तो", "फिर", "आणि")
_NOW_WORDS = re.compile(r"\b(now|right now|currently|abhi|abhi ka)\b", re.IGNORECASE)
_MAX_SHORT_WORDS = 4


def is_follow_up(message: str) -> bool:
    text = message.strip()
    if _FOLLOW_UP_START.search(text) or text.startswith(_DEVANAGARI_START):
        return True
    return len(text.split()) <= _MAX_SHORT_WORDS


def apply_context(intent: ChatIntent, message: str, context: ChatContext | None) -> ChatIntent:
    """Return a copy of ``intent`` with missing slots filled from ``context``."""
    if context is None or not is_follow_up(message):
        return intent
    updates: dict = {}

    asks_climate = is_climate_query(message)
    asks_nwp = is_nwp_query(message)
    if context.intent in {"climate", "nwp"} and not asks_climate and not asks_nwp:
        updates["intent"] = context.intent
        if context.intent == "climate":
            updates["climate_period"] = context.climate_period or "last_30_days"

    if intent.date_reference == "now" and not _NOW_WORDS.search(message) and context.date_reference:
        updates["date_reference"] = context.date_reference

    if intent.weather_parameter == "general" and context.weather_parameter:
        updates["weather_parameter"] = context.weather_parameter

    merged = intent.model_copy(update=updates)
    # A weather follow-up for a later time is a forecast ("aur parso?").
    if merged.intent == "current_weather" and merged.date_reference not in {"now", "today"}:
        merged = merged.model_copy(update={"intent": "forecast"})
    return merged
