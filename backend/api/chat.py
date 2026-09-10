"""
backend/api/chat.py — grounded conversational weather endpoint.

POST /api/chat

Flow:
  message → query_parser → location resolution → query_service (Open-Meteo)
  → response_generator → ChatResponse

Location priority:
  1. Place name extracted from the query (geocoded)
  2. Request-time latitude/longitude on the body (caller's GPS for this query)
  3. Trusted default from a verified Supabase session (RLS)
  4. Ask the user for a location

Client ``user_id`` and client ``default_*`` fields are ignored.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from advisory import evaluate_advisory
from auth.trusted_location import get_trusted_default_location
from geocoding import geocode_place, reverse_geocode
from llm.query_parser import parse_query
from llm.response_generator import ask_for_location, generate_response, unknown_location
from models.chat import ChatIntent, ChatRequest, ChatResponse, ResolvedLocation
from query_service import fetch_validated_weather, select_weather_facts

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: Optional[str] = Header(default=None),
) -> ChatResponse:
    intent: ChatIntent = await parse_query(body.message)

    has_request_coords = body.latitude is not None and body.longitude is not None
    location: Optional[ResolvedLocation] = None

    if intent.location_name:
        try:
            geo = await geocode_place(intent.location_name)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        if geo is None:
            return ChatResponse(
                message=unknown_location(intent, intent.location_name),
                intent=intent,
                location=None,
                weather=None,
                source="open-meteo",
            )
        location = ResolvedLocation(
            name=geo.name,
            latitude=geo.latitude,
            longitude=geo.longitude,
            source="explicit_query",
        )
        logger.info("Chat location from query name %s", intent.location_name)

    elif has_request_coords:
        assert body.latitude is not None and body.longitude is not None
        label = await reverse_geocode(body.latitude, body.longitude)
        location = ResolvedLocation(
            name=label or "selected location",
            latitude=body.latitude,
            longitude=body.longitude,
            source="request_coordinates",
        )
        logger.info("Chat location from request coordinates")

    else:
        trusted = await get_trusted_default_location(authorization)
        if trusted is not None:
            location = ResolvedLocation(
                name=trusted.name or "saved location",
                latitude=trusted.latitude,
                longitude=trusted.longitude,
                source="trusted_user_default",
            )
            logger.info("Chat location from trusted session default")

    if location is None:
        return ChatResponse(
            message=ask_for_location(intent),
            intent=intent,
            location=None,
            weather=None,
            source="open-meteo",
        )

    try:
        weather = await fetch_validated_weather(location.latitude, location.longitude)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to build weather facts: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to process weather data. Please try again.",
        ) from exc

    facts = select_weather_facts(weather, intent, location.name)
    advisory = evaluate_advisory(facts, intent.weather_parameter)
    message = await generate_response(intent, facts, advisory)
    return ChatResponse(
        message=message,
        intent=intent,
        location=location,
        weather=facts,
        advisory=advisory,
        source="open-meteo",
    )
