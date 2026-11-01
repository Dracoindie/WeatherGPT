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
--    Changes what WeatherGPT replies emphasise; never the numbers.
--    Covered by the existing profiles RLS policies (own row only).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'citizen';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('citizen', 'farmer', 'aviation', 'disaster_manager', 'researcher'));
