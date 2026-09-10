"""
tests/test_location.py

Geolocation state-machine tests (no browser) plus /api/chat location
priority against the current contract. All network I/O is mocked.
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from auth.trusted_location import TrustedDefaultLocation
from geocoding import GeoResult
from main import app
from test_chat import chat_patches, post_chat, sample_weather

client = TestClient(app)

PUNE = GeoResult(18.5204, 73.8567, "Pune")
DELHI = TrustedDefaultLocation(latitude=28.6139, longitude=77.2090, name="New Delhi")


class GeolocationStateMachine:
    """
    Minimal Python simulation of useGeolocation hook states.
    Mirrors the state transitions in lib/location/useGeolocation.ts.
    """

    PERMISSION_DENIED = 1
    POSITION_UNAVAILABLE = 2
    TIMEOUT = 3

    def __init__(self):
        self.status = "idle"
        self.coords = None
        self.error = None

    def simulate_success(self, lat: float, lng: float, accuracy: float = 20.0):
        self.coords = {"latitude": lat, "longitude": lng, "accuracy": accuracy}
        self.status = "granted"
        self.error = None

    def simulate_error(self, code: int):
        if code == self.PERMISSION_DENIED:
            self.status = "denied"
            self.error = (
                "Location permission was denied. You can still enter a location manually."
            )
        elif code == self.POSITION_UNAVAILABLE:
            self.status = "unavailable"
            self.error = (
                "Your current position is unavailable. Please enter a location manually."
            )
        elif code == self.TIMEOUT:
            self.status = "timeout"
            self.error = "Location request timed out. Please try again."
        else:
            self.status = "unavailable"
            self.error = "An unknown location error occurred."
        self.coords = None

    def simulate_unsupported(self):
        self.status = "unavailable"
        self.error = "Your browser does not support geolocation."
        self.coords = None


class TestGeolocationStateMachine:
    def test_initial_state_is_idle(self):
        geo = GeolocationStateMachine()
        assert geo.status == "idle"
        assert geo.coords is None
        assert geo.error is None

    def test_permission_granted_sets_coords(self):
        geo = GeolocationStateMachine()
        geo.simulate_success(18.5204, 73.8567, 15.0)
        assert geo.status == "granted"
        assert geo.coords is not None
        assert geo.coords["latitude"] == 18.5204
        assert geo.coords["longitude"] == 73.8567
        assert geo.coords["accuracy"] == 15.0
        assert geo.error is None

    def test_coords_do_not_include_altitude(self):
        """Privacy requirement: altitude must never be stored."""
        geo = GeolocationStateMachine()
        geo.simulate_success(18.5204, 73.8567)
        assert "altitude" not in geo.coords
        assert "heading" not in geo.coords
        assert "speed" not in geo.coords

    def test_permission_denied_sets_correct_state(self):
        geo = GeolocationStateMachine()
        geo.simulate_error(GeolocationStateMachine.PERMISSION_DENIED)
        assert geo.status == "denied"
        assert geo.coords is None
        assert geo.error is not None
        assert "manually" in geo.error.lower()

    def test_position_unavailable_sets_correct_state(self):
        geo = GeolocationStateMachine()
        geo.simulate_error(GeolocationStateMachine.POSITION_UNAVAILABLE)
        assert geo.status == "unavailable"
        assert geo.coords is None

    def test_timeout_sets_correct_state(self):
        geo = GeolocationStateMachine()
        geo.simulate_error(GeolocationStateMachine.TIMEOUT)
        assert geo.status == "timeout"
        assert "timed out" in (geo.error or "").lower()

    def test_unsupported_browser_sets_unavailable(self):
        geo = GeolocationStateMachine()
        geo.simulate_unsupported()
        assert geo.status == "unavailable"
        assert "does not support" in (geo.error or "").lower()

    def test_denied_does_not_block_manual_entry(self):
        geo = GeolocationStateMachine()
        geo.simulate_error(GeolocationStateMachine.PERMISSION_DENIED)
        assert geo.status == "denied"

        geo.coords = {"latitude": 28.6139, "longitude": 77.2090, "accuracy": 0}
        geo.status = "granted"
        geo.error = None

        assert geo.status == "granted"
        assert geo.coords["latitude"] == 28.6139


class TestChatLocationPriority:
    """
    Current POST /api/chat priority:
      named place in the query
      > request-time latitude/longitude
      > trusted session default (JWT + RLS)
      > ask for a location (HTTP 200, no weather)
    """

    def test_named_query_beats_request_coords_and_default(self):
        patches = chat_patches(geo=PUNE, trusted=DELHI)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={
                    "message": "Pune mein kal baarish hogi?",
                    "latitude": 28.6139,
                    "longitude": 77.2090,
                },
                headers={"Authorization": "Bearer fake-token"},
            )
        assert resp.status_code == 200
        loc = resp.json()["location"]
        assert loc["source"] == "explicit_query"
        assert loc["latitude"] == pytest.approx(18.5204)

    def test_request_coordinates_beat_trusted_default(self):
        patches = chat_patches(
            trusted=DELHI,
            reverse_name="Pune",
            weather=sample_weather(18.5204, 73.8567),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={
                    "message": "What is the weather today?",
                    "latitude": 18.5204,
                    "longitude": 73.8567,
                },
                headers={"Authorization": "Bearer fake-token"},
            )
        assert resp.status_code == 200
        loc = resp.json()["location"]
        assert loc["source"] == "request_coordinates"
        assert loc["latitude"] == pytest.approx(18.5204)

    def test_trusted_default_when_no_explicit(self):
        patches = chat_patches(
            trusted=DELHI,
            weather=sample_weather(28.6139, 77.2090, 33.0),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={"message": "What is the weather today?"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert resp.status_code == 200
        loc = resp.json()["location"]
        assert loc["source"] == "trusted_user_default"
        assert loc["latitude"] == pytest.approx(28.6139)

    def test_no_location_asks_instead_of_400(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Will it rain tomorrow?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"] is None
        assert body["weather"] is None
        assert "location" in body["message"].lower()

    def test_legacy_body_defaults_are_not_a_source(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={
                    "message": "What is the weather today?",
                    "default_latitude": 28.6139,
                    "default_longitude": 77.2090,
                    "default_location_name": "New Delhi",
                },
            )
        assert resp.status_code == 200
        assert resp.json()["location"] is None

    def test_partial_request_coords_fall_through_to_ask(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Weather?", latitude=18.5204)
        assert resp.status_code == 200
        assert resp.json()["location"] is None

    def test_response_includes_resolved_coords_not_weather_url(self):
        patches = chat_patches(geo=GeoResult(19.0760, 72.8777, "Mumbai"))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("What's the temperature in Mumbai?")
        assert resp.status_code == 200
        body = resp.json()
        assert "weather_endpoint" not in body
        assert "location_context" not in body
        assert body["location"]["latitude"] == pytest.approx(19.0760)
        assert body["source"] == "open-meteo"

    def test_empty_message_returns_422(self):
        resp = post_chat("", latitude=18.5204, longitude=73.8567)
        assert resp.status_code == 422
