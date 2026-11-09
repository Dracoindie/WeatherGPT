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
