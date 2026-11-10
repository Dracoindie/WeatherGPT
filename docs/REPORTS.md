# Community reports ("Waze for weather")

Signed-in users report what they see at a point on the map. Every report is a
**community report, unverified**: it is shown on the map and the risk board, it
feeds the experimental waterlogging estimate (`docs/WATERLOGGING.md`), and it
**never changes a forecast number or an alert level** (`tests/test_reports.py`
checks that no forecast, alert, route or risk-board module imports it).

## What can be reported

| Kind | Stays on the map |
|------|------------------|
| Waterlogging, fallen tree, hail, heavy rain, strong wind | 6 h |
| Landslide, road blocked by weather | 24 h |

Optional: a short note (at most 280 characters) and one photo.

## Safety

- **Sign-in required.** The backend checks the Supabase access token with
  Supabase Auth (`GET /auth/v1/user`); the user id comes from that answer, never
  from the request.
- **Rate limit:** one report a minute and at most 5 an hour per person (HTTP 429
  with `Retry-After`).
- **Expiry:** see the table; expired reports are never returned.
- **Flags:** anyone signed in can flag a report once; at 3 flags it is hidden for
  everyone. You cannot confirm or flag your own report, and you vote once per
  report (confirm or flag).
- **No identity:** the API never returns the reporter's id or name. The card says
  "a resident" and an approximate time (rounded down to 10 minutes).
- **Private tables:** `community_reports` and `report_votes` have RLS on with no
  policies and no grants for browsers. Only the backend reads and writes them,
  with the service-role key (backend only). So nobody can read who reported what,
  or forge the trust inputs by writing to the table.
- **Photos:** decoded and re-encoded as a new JPEG, at most 1600 px wide. Only
  the pixels are copied, so **all metadata is dropped**: EXIF (including GPS),
  XMP, IPTC, ICC profiles and comments. The camera's rotation is applied first.
  Uploads are capped at 8 MB and 40 megapixels (a "decompression bomb" is
  refused). HEIC photos are converted to JPEG in the browser before upload;
  anything Pillow cannot read gets "Please use a JPEG or PNG photo". Photos sit
  in a private Storage bucket and are served by the backend
  (`GET /api/reports/{id}/photo`) only while the report is live.

## Trust score

> **Default, not calibrated.** The weights, bands and level cut-offs below are
> reasoned starting values. They have not been fitted to real reports. The
> report card says so too ("The trust weights are defaults, not calibrated").
> Review them against real reports after a few monsoon days before relying on
> the levels.

Each report gets a score from 0 to 1, shown as **Low**, **Medium** or **High**:

```
score = 0.35 × model + 0.25 × nearby + 0.15 × age + 0.25 × reporter − 0.1 × flags
```

| Part | 0 … 1 | From |
|------|-------|------|
| model | does the forecast model support it? | One Open-Meteo request when the report is made (past 24 h and next 2 h at the point). Rain kinds (heavy rain, waterlogging): the peak hourly rain over the past 3 h and the next hour, 0.1 when dry (< 0.2 mm/h), 0.4 light (< 2.5 mm/h), 0.7 moderate (< 7.6 mm/h), 1.0 heavy (AMS Glossary rain intensity). Wind kinds (strong wind, fallen tree): the peak gust, 0.2 below 20 km/h, 0.5 below 40, 0.8 below 65, 1.0 above (the alert rules' strong-wind and gale values); a fallen tree never scores below 0.35 (trees fall in calm weather too). Landslide and road blocked: the past 24 h rain, 0.3 below 5 mm, 0.5 below 15 (heavy rain rule), 0.8 below 50 (extreme rain rule), 1.0 above. Hail: 1.0 when the model shows WMO 96/99, 0.6 with any rain, else 0.2. If Open-Meteo cannot be asked: 0.5 (neither support nor contradiction). |
| nearby | do others see it too? | Confirmations, plus reports by **other people** of a related kind (rain: heavy rain, waterlogging, hail; wind: strong wind, fallen tree; ground: landslide, road blocked) within 2 km and 3 h. Three or more give 1. |
| age | how fresh is it? | 1 when made, falling to 0 at the end of its lifetime. |
| reporter | the reporter's track record | Their past reports (model agreement + 0.1 per confirmation − 0.2 per flag, each counted up to 3), averaged with a prior of 0.5 worth two reports, so a new reporter starts in the middle. Taken when the report is made. |
| flags | | Each flag costs 0.1; 3 flags hide the report. |

**Levels:** below 0.4 Low, below 0.65 Medium, else High (`thresholds.py`:
`REPORT_TRUST_MEDIUM`, `REPORT_TRUST_HIGH`). Every band above lives in
`thresholds.py`. The API returns the score and its parts, so the card can say why.

### Low-trust reports are hidden by default

On the map only **Medium** and **High** trust reports are drawn and counted. If
the view holds Low-trust reports, the panel under the map offers **"Show
unverified reports (N hidden)"**; pressing it draws them too (small dots), and
pressing again hides them. The risk board counts Medium and High reports per
district and adds "Low-trust reports hidden: N (show them on the map)".

- **Your own report always shows to you**, whatever its trust, so it never seems lost.
- A report that is hidden here is still stored, still expires and can still be
  confirmed once shown; three flags still remove it for everyone.
- The choice is made in the browser from the level the API returns
  (`hiddenByDefault` in `weathergpt-web/lib/api/reports.ts`); the API itself
  lists every live report with its trust, and the waterlogging estimate still
  counts low-trust waterlogging reports at their small weight (0.25).

Examples: a fresh heavy-rain report while the model shows heavy rain, from a new
reporter, scores 0.35 + 0.15 + 0.125 = 0.625 (Medium); one confirmation lifts it
to 0.71 (High). The same report while the model is dry scores 0.31 (Low).

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/reports?south&west&north&east` | Live reports in the box (at most 15° a side, 500 rows), newest first, with trust. With a token, also `my_vote` and `mine`. Always carries `label` ("Community report, unverified …"). |
| POST | `/api/reports` | Signed in. Multipart: `kind`, `latitude`, `longitude`, optional `note`, optional `photo`. 201 with the public report. |
| POST | `/api/reports/{id}/vote` | Signed in. `{"vote": "confirm"}` or `{"vote": "flag"}`. |
| GET | `/api/reports/{id}/photo` | The cleaned JPEG while the report is live. |

Errors carry a `code` for the UI's message in the user's language: `sign_in`,
`rate_limited`, `bad_kind`, `box_too_large`, `photo_format`, `photo_too_large`,
`photo_too_many_pixels`, `own_report`, `already_voted`, `gone`, `unavailable`,
`not_configured`.

## Setup

Run `supabase/migration_8_reports.sql` once in the Supabase SQL editor (it is
also in `schema.sql`). The backend needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`; without the service-role key the endpoints answer
503 `not_configured` and the map says reports are not set up.
