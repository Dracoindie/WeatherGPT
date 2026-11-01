"""
backend/api/chat.py — grounded conversational weather endpoint.

POST /api/chat

Flow:
  message → query_parser → follow-up context → location resolution
  → data source for the intent → grounded reply → ChatResponse

Data source by intent:
  current_weather / forecast → Open-Meteo forecast (query_service)
  climate                    → Open-Meteo archive vs past years (climate.analysis)
  nwp                        → GFS via NOAA NOMADS (nwp.service + nwp.facts)

Location priority:
  1. Place name extracted from the query (geocoded)
  2. Request-time latitude/longitude on the body (caller's GPS for this query)
  3. The previous answer's location (follow-up ``context``)
  4. Trusted default from a verified Supabase session (RLS)
  5. Ask the user for a location

Client ``user_id`` and client ``default_*`` fields are ignored.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from advisory import evaluate_advisory
from auth.trusted_location import get_trusted_default_location
from climate.analysis import fetch_climate_facts
from geocoding import geocode_place, reverse_geocode
from llm.follow_up import apply_context
from llm.query_parser import parse_query
from llm.response_generator import ask_for_location, generate_response, unknown_location
from llm.source_replies import climate_template, grounded_reply, nwp_template, nwp_unavailable
from models.chat import ChatIntent, ChatRequest, ChatResponse, ResolvedLocation
from query_service import fetch_validated_weather, focus_facts, select_period_facts
from roles.notes import role_note

logger = logging.getLogger(__name__)

router = APIRouter()


async def _resolve_location(
    intent: ChatIntent, body: ChatRequest, authorization: Optional[str]
) -> ResolvedLocation | None | str:
    """ResolvedLocation, None (ask for one), or the unknown place name (str)."""
    if intent.location_name:
        try:
            geo = await geocode_place(intent.location_name)
        except RuntimeError as exc:
            logger.error("Geocode failed for location: %s", intent.location_name, exc_info=exc)
            raise HTTPException(status_code=502, detail=f"Failed to geocode location: {intent.location_name}") from exc
        if geo is None:
            logger.warning("No location found for: %s", intent.location_name)
            return intent.location_name
        logger.info("Chat location from query name %s", intent.location_name)
        return ResolvedLocation(name=geo.name, latitude=geo.latitude, longitude=geo.longitude, source="explicit_query")

    if body.latitude is not None and body.longitude is not None:
        try:
            label = await reverse_geocode(body.latitude, body.longitude)
        except RuntimeError as exc:
            logger.error("Reverse geocode failed for coordinates: %.4f, %.4f", body.latitude, body.longitude, exc_info=exc)
            raise HTTPException(status_code=502, detail="Failed to reverse geocode coordinates") from exc
        logger.info("Chat location from request coordinates")
        return ResolvedLocation(
            name=label or "selected location",
            latitude=body.latitude,
            longitude=body.longitude,
            source="request_coordinates",
        )

    ctx = body.context
    if ctx is not None and ctx.latitude is not None and ctx.longitude is not None:
        logger.info("Chat location from conversation context")
        return ResolvedLocation(
            name=ctx.location_name or "previous location",
            latitude=ctx.latitude,
            longitude=ctx.longitude,
            source="conversation_context",
        )

    trusted = await get_trusted_default_location(authorization)
    if trusted is not None:
        logger.info("Chat location from trusted session default")
        return ResolvedLocation(
            name=trusted.name or "saved location",
            latitude=trusted.latitude,
            longitude=trusted.longitude,
            source="trusted_user_default",
        )
    return None


async def _climate_answer(intent: ChatIntent, location: ResolvedLocation) -> ChatResponse:
    try:
        facts = await fetch_climate_facts(
            location.latitude,
            location.longitude,
            location.name,
            intent.climate_period or "last_30_days",
            datetime.now(timezone.utc).date(),
        )
    except Exception as exc:
        logger.error("Climate archive fetch failed: %s", exc, exc_info=exc)
        raise HTTPException(status_code=502, detail="Climate archive is temporarily unavailable.") from exc
    intent = intent.model_copy(update={"climate_period": facts.period})
    message = await grounded_reply(intent, facts, climate_template(intent, facts))
    return ChatResponse(message=message, intent=intent, location=location, climate=facts, source=facts.source)


async def _nwp_answer(intent: ChatIntent, location: ResolvedLocation) -> ChatResponse:
    try:
        from nwp.facts import hours_to_request, summarise_nwp
        from nwp.service import get_nwp_forecast
    except (ImportError, RuntimeError, OSError) as exc:
        logger.warning("NWP unavailable for chat: %s", exc)
        return ChatResponse(message=nwp_unavailable(intent), intent=intent, location=location, source="gfs-nomads")

    # Open-Meteo supplies the location's timezone, so "tomorrow" is local.
    try:
        weather = await fetch_validated_weather(location.latitude, location.longitude)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    now = datetime.now(timezone.utc)
    hours = hours_to_request(intent, weather.timezone, now)
    if hours is None:
        from models.chat import NwpFacts

        facts = NwpFacts(
            run=now.replace(minute=0, second=0, microsecond=0).isoformat(),
            location=location.name,
            requested_time=intent.date_reference,
            timezone=weather.timezone,
            hours=0,
            period_available=False,
        )
    else:
        try:
            gfs = await get_nwp_forecast(location.latitude, location.longitude, hours)
        except Exception as exc:
            logger.error("GFS fetch failed: %s", exc)
            return ChatResponse(message=nwp_unavailable(intent), intent=intent, location=location, source="gfs-nomads")
        facts = summarise_nwp(gfs, intent, location.name, weather.timezone, now)
    message = await grounded_reply(intent, facts, nwp_template(intent, facts))
    return ChatResponse(message=message, intent=intent, location=location, nwp=facts, source=facts.source)


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: Optional[str] = Header(default=None),
) -> ChatResponse:
    parsed = await parse_query(body.message)
    intent = apply_context(parsed, body.message, body.context)

    try:
        resolved = await _resolve_location(intent, body, authorization)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to resolve location: %s", exc, exc_info=exc)
        resolved = None

    if isinstance(resolved, str):
        return ChatResponse(message=unknown_location(intent, resolved), intent=intent, source="open-meteo")
    if resolved is None:
        return ChatResponse(message=ask_for_location(intent), intent=intent, source="open-meteo")
    location = resolved

    if intent.intent == "climate":
        return await _climate_answer(intent, location)
    if intent.intent == "nwp":
        return await _nwp_answer(intent, location)

    try:
        weather = await fetch_validated_weather(location.latitude, location.longitude)
    except RuntimeError as exc:
        logger.error("Failed to fetch weather for location: %.4f, %.4f", location.latitude, location.longitude, exc_info=exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Unexpected error fetching weather: %s", exc, exc_info=exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc

    try:
        period_facts = select_period_facts(weather, intent, location.name)
        facts = focus_facts(period_facts, intent.weather_parameter)
    except Exception as exc:
        logger.error("Failed to select weather facts: %s", exc, exc_info=exc)
        raise HTTPException(status_code=500, detail="Failed to process weather data") from exc

    try:
        # The advisory sees every value for the period, so heavy rain is still
        # flagged when the question was about temperature.
        advisory = evaluate_advisory(period_facts, intent.weather_parameter)
    except Exception as exc:
        logger.error("Failed to evaluate advisory: %s", exc, exc_info=exc)
        raise HTTPException(status_code=500, detail="Failed to generate advisory") from exc

    try:
        message = await generate_response(intent, facts, advisory)
    except Exception as exc:
        logger.error("Failed to generate response: %s", exc, exc_info=exc)
        raise HTTPException(status_code=500, detail="Failed to generate response") from exc

    # Role focus: one deterministic sentence from the same verified period values.
    note = role_note(body.role, period_facts, advisory, intent.language)
    if note:
        message = f"{message} {note}"

    return ChatResponse(
        message=message,
        intent=intent,
        location=location,
        weather=facts,
        advisory=advisory,
        source="open-meteo",
    )
