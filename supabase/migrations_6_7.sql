-- =============================================================================
-- WeatherGPT: migrations 6 and 7 only
-- =============================================================================
-- For a database that already has sections 1-5 of schema.sql (profiles,
-- user_preferences, saved_locations, RLS, grants). A new database should run
-- schema.sql instead; it already contains these two migrations.
--
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- Safe to run more than once: ADD COLUMN IF NOT EXISTS, CREATE TABLE / INDEX
-- IF NOT EXISTS, and DROP ... IF EXISTS before re-creating the constraint and
-- policies (Postgres has no CREATE OR REPLACE for those). It is one
-- transaction, so it applies completely or not at all.
-- Same SQL as sections 6 and 7 of schema.sql; keep the two in sync.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 6. Migration 2026-11: role mode on profiles
--    Changes what WeatherGPT replies emphasise; never the numbers.
--    Covered by the existing profiles RLS policies (own row only).
--    Existing rows get the default 'citizen'.
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

COMMIT;

-- ---------------------------------------------------------------------------
-- Check: expect one row each for profiles.role and alert_subscriptions with
-- rls_enabled = true and policies = 2.
-- ---------------------------------------------------------------------------
SELECT 'profiles.role' AS item,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role') AS detail
UNION ALL
SELECT 'alert_subscriptions',
       format('rls_enabled = %s, policies = %s',
              (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.alert_subscriptions'::regclass),
              (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'alert_subscriptions'));
