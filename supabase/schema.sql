-- =============================================================================
-- WeatherGPT SIH 2026 — Supabase Database Schema
-- =============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles
--    Linked 1-to-1 with auth.users.
--    A trigger auto-creates a row on signup.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
    id                   UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    full_name            TEXT,
    email                TEXT,
    preferred_language   TEXT        NOT NULL DEFAULT 'English',
    default_latitude     DOUBLE PRECISION,
    default_longitude    DOUBLE PRECISION,
    default_location_name TEXT,
    location_permission  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.handle_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_profiles_updated_at();

-- Auto-create a profile row when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. user_preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id                UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    temperature_unit       TEXT    NOT NULL DEFAULT 'celsius',
    notification_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    severe_alert_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    voice_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    preferred_language     TEXT    NOT NULL DEFAULT 'English'
);

-- ---------------------------------------------------------------------------
-- 3. saved_locations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.saved_locations (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    latitude   DOUBLE PRECISION NOT NULL,
    longitude  DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------

-- profiles -------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- user_preferences -----------------------------------------------------------
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences"   ON public.user_preferences;
DROP POLICY IF EXISTS "Users can upsert own preferences" ON public.user_preferences;

CREATE POLICY "Users can view own preferences"
    ON public.user_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own preferences"
    ON public.user_preferences FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- saved_locations ------------------------------------------------------------
ALTER TABLE public.saved_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own locations"   ON public.saved_locations;
DROP POLICY IF EXISTS "Users can manage own locations" ON public.saved_locations;

CREATE POLICY "Users can view own locations"
    ON public.saved_locations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own locations"
    ON public.saved_locations FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Grants — anon role cannot read any table; authenticated role uses RLS
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_locations  TO authenticated;
-- anon gets no grants — signup/login is handled by auth.users, not these tables

-- ---------------------------------------------------------------------------
-- 6. Migration 2026-11: role mode on profiles
--    (Sections 6 and 7 are also in migrations_6_7.sql for databases that
--    already have 1-5; keep the two in sync.)
--    Changes what WeatherGPT replies emphasise; never the numbers.
--    Covered by the existing profiles RLS policies (own row only).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'citizen';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('citizen', 'farmer', 'aviation', 'disaster_manager', 'researcher'));

-- ---------------------------------------------------------------------------
-- 7. Migration 2026-11: early-warning subscriptions (Web Push)
--    A browser subscribes the signed-in user to alerts for one location.
--    Users manage only their own rows (RLS). The backend alert job reads all
--    rows with the service-role key (bypasses RLS; backend-only secret).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_subscriptions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
    location_name    TEXT        NOT NULL,
    latitude         DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude        DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    endpoint         TEXT        NOT NULL,
    p256dh           TEXT        NOT NULL,
    auth             TEXT        NOT NULL,
    language         TEXT        NOT NULL DEFAULT 'en',
    last_severity    TEXT        NOT NULL DEFAULT 'none',
    last_notified_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, endpoint, latitude, longitude)
);

CREATE INDEX IF NOT EXISTS alert_subscriptions_user_idx ON public.alert_subscriptions (user_id);

ALTER TABLE public.alert_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own alert subscriptions"   ON public.alert_subscriptions;
DROP POLICY IF EXISTS "Users can manage own alert subscriptions" ON public.alert_subscriptions;

CREATE POLICY "Users can view own alert subscriptions"
    ON public.alert_subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own alert subscriptions"
    ON public.alert_subscriptions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_subscriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Migration 2026-11: community reports (docs/REPORTS.md)
--    Run once in the Supabase SQL editor (also appended to schema.sql; keep the
--    two in sync). Idempotent.
--
--    Private by design: RLS is ON with NO policies, and anon/authenticated get
--    no grants, so browsers can neither read nor write these tables directly.
--    The backend is the only gateway (service-role key, backend only): it
--    verifies the user, enforces the rate limit, computes the trust inputs and
--    never returns user_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_reports (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    kind              TEXT        NOT NULL CHECK (kind IN (
                          'waterlogging', 'fallen_tree', 'landslide', 'hail',
                          'heavy_rain', 'strong_wind', 'road_blocked')),
    latitude          DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude         DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    note              TEXT        CHECK (char_length(note) <= 280),
    photo_path        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    model_agreement   REAL        NOT NULL DEFAULT 0.5 CHECK (model_agreement BETWEEN 0 AND 1),
    model_known       BOOLEAN     NOT NULL DEFAULT TRUE,
    reporter_accuracy REAL        NOT NULL DEFAULT 0.5 CHECK (reporter_accuracy BETWEEN 0 AND 1),
    confirm_count     INTEGER     NOT NULL DEFAULT 0,
    flag_count        INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS community_reports_live_idx  ON public.community_reports (expires_at, latitude, longitude);
CREATE INDEX IF NOT EXISTS community_reports_user_idx  ON public.community_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_votes (
    report_id  UUID        NOT NULL REFERENCES public.community_reports (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    vote       TEXT        NOT NULL CHECK (vote IN ('confirm', 'flag')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, user_id)   -- one vote per person per report
);

CREATE INDEX IF NOT EXISTS report_votes_user_idx ON public.report_votes (user_id);

-- vote counters on the report, kept by the database
CREATE OR REPLACE FUNCTION public.report_votes_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.vote = 'confirm' THEN
        UPDATE public.community_reports SET confirm_count = confirm_count + 1 WHERE id = NEW.report_id;
    ELSE
        UPDATE public.community_reports SET flag_count = flag_count + 1 WHERE id = NEW.report_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_votes_count ON public.report_votes;
CREATE TRIGGER report_votes_count AFTER INSERT ON public.report_votes
    FOR EACH ROW EXECUTE FUNCTION public.report_votes_count();

ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_votes      ENABLE ROW LEVEL SECURITY;
-- no policies on purpose (backend only)
REVOKE ALL ON public.community_reports FROM anon, authenticated;
REVOKE ALL ON public.report_votes      FROM anon, authenticated;

-- Photos: a private bucket, JPEG only, 2 MB after the backend re-encodes them
-- (uploads are capped at 8 MB before re-encoding). No storage policies: only
-- the service role reads and writes it; the backend serves photos itself.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-photos', 'report-photos', FALSE, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
    SET public = FALSE, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg'];
