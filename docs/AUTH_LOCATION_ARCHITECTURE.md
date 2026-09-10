# WeatherGPT — Auth, Profile & Location Architecture

SIH 2026 | Problem Statement SIH26068

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER (Browser)                       │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   Supabase Auth      │      │  navigator.geolocation   │
│  (email/password)    │      │  getCurrentPosition()    │
│                      │      │  — on demand only —      │
│  • signup            │      │  — no watchPosition —    │
│  • login             │      └────────────┬─────────────┘
│  • logout            │                   │ coords (lat, lng, accuracy)
│  • JWT session       │                   │ (no altitude/heading/speed)
└──────────┬───────────┘                   ▼
           │ JWT                ┌──────────────────────────┐
           │                   │  Nominatim (OSM)         │
           ▼                   │  Reverse Geocode         │
┌──────────────────────┐       │  lat,lng → city name     │
│  Supabase PostgreSQL │       └────────────┬─────────────┘
│                      │                    │ displayName
│  profiles            │◄───────────────────┘
│  user_preferences    │  upsertProfile()
│  saved_locations     │  (default_latitude, default_longitude,
│                      │   default_location_name, location_permission)
│  [RLS enforced]      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│                     Chat Location Priority                    │
│                                                              │
│  POST /api/chat                                              │
│                                                              │
│  1. explicit_latitude + explicit_longitude  (highest)        │
│          └─ from NLP/user query parsing                      │
│  2. default_latitude + default_longitude    (fallback)       │
│          └─ from user's saved profile                        │
│  3. Neither present → HTTP 400                               │
│          └─ "Please specify a location"                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ resolved (latitude, longitude)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│             GET /api/weather?latitude=…&longitude=…          │
│                                                              │
│  Open-Meteo Forecast API                                     │
│    → httpx.AsyncClient                                       │
│    → Pydantic validation (WeatherResponse)                   │
│    → structured weather object                               │
│                                                              │
│  source: "open-meteo" (always)                               │
│  LLM must NEVER override these values                        │
└──────────────────────┬───────────────────────────────────────┘
                       │ WeatherResponse (JSON)
                       ▼
              ┌─────────────────┐
              │  LLM Layer      │  ← NOT YET CONNECTED
              │  (future)       │    Must use weather facts
              │                 │    from WeatherResponse only
              └─────────────────┘
```

---

## Authentication Flow

### Signup

```
1. User fills SignUpForm (email, password, optional full_name)
2. Client-side validation:
   - email must match RFC 5322-like pattern
   - password must be ≥ 8 characters
3. supabase.auth.signUp({ email, password, options: { data: { full_name } } })
4. Supabase sends confirmation email
5. User clicks confirmation link
6. Supabase trigger: on_auth_user_created → INSERT INTO profiles (id, email)
7. User can now log in
```

### Login

```
1. User fills SignInForm (email, password)
2. supabase.auth.signInWithPassword({ email, password })
3. Supabase returns JWT session
4. AuthContext (onAuthStateChange) updates user state
5. Next.js middleware reads session cookie and allows /dashboard access
6. router.push('/dashboard')
```

### Logout

```
1. User clicks "Sign out"
2. supabase.auth.signOut()
3. AuthContext clears user/session state
4. Middleware detects no session, redirects to /login on next navigation
```

### Session Refresh

```
Every request → middleware.ts → updateSession()
  → createServerClient reads session cookie
  → supabase.auth.getUser() refreshes JWT if needed
  → updated cookie set in response headers
```

---

## Location Permission Flow

```
Dashboard loads
      │
      ▼
Has saved default location?
      │ Yes → show saved location, fetch weather immediately
      │ No  → show LocationPicker
              │
              ├── [User clicks "Use my current location"]
              │         │
              │         ▼
              │   navigator.geolocation.getCurrentPosition()
              │         │
              │   ┌─────┴──────────────────────────────┐
              │   │ Granted             Denied/Error    │
              │   │    │                     │          │
              │   │    ▼                     ▼          │
              │   │ Nominatim         Manual text       │
              │   │ reverse geocode   input shown       │
              │   │    │              (app not blocked) │
              │   └────┼─────────────────────┼──────────┘
              │        │                     │
              │        ▼                     ▼
              │   upsertProfile()    Nominatim forward
              │   (save as default)  geocode → coords
              │        │                     │
              └────────┴─────────────────────┘
                       │
                       ▼
               fetch /api/weather?lat=…&lng=…
```

---

## Database Schema

### `profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | FK → auth.users, cascades on delete |
| `full_name` | TEXT | Optional |
| `email` | TEXT | Copied from auth.users on signup |
| `preferred_language` | TEXT | Default: 'English' |
| `default_latitude` | DOUBLE PRECISION | Set after location permission |
| `default_longitude` | DOUBLE PRECISION | Set after location permission |
| `default_location_name` | TEXT | Human-readable city name |
| `location_permission` | BOOLEAN | Default: false |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

### `user_preferences`

| Column | Type | Default |
|--------|------|---------|
| `user_id` | UUID PK | FK → auth.users |
| `temperature_unit` | TEXT | 'celsius' |
| `notification_enabled` | BOOLEAN | true |
| `severe_alert_enabled` | BOOLEAN | true |
| `voice_enabled` | BOOLEAN | true |
| `preferred_language` | TEXT | 'English' |

### `saved_locations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto gen_random_uuid() |
| `user_id` | UUID | FK → auth.users |
| `name` | TEXT | City/place name |
| `latitude` | DOUBLE PRECISION | |
| `longitude` | DOUBLE PRECISION | |
| `created_at` | TIMESTAMPTZ | Auto |

---

## Row Level Security Summary

| Table | Policy | Condition |
|-------|--------|-----------|
| profiles | SELECT | `auth.uid() = id` |
| profiles | UPDATE | `auth.uid() = id` |
| profiles | INSERT | `auth.uid() = id` |
| user_preferences | ALL | `auth.uid() = user_id` |
| saved_locations | SELECT | `auth.uid() = user_id` |
| saved_locations | ALL | `auth.uid() = user_id` |

**No cross-user data access is possible even if an attacker knows another user's UUID.**

---

## Privacy Model

| Data | Stored | How long | Notes |
|------|--------|----------|-------|
| Password | ❌ Never | — | Supabase Auth handles hashing |
| Email | ✅ profiles.email | Until account deleted | Required for identification |
| Full name | ✅ profiles.full_name | Until account deleted | Optional, user-provided |
| Current GPS coords | ❌ Never as history | — | Only latest default saved |
| Default location | ✅ profiles.default_* | Until changed | One location, not a history |
| Location history | ❌ Never | — | By design |
| Auth tokens | ❌ Never in DB | — | Supabase session cookies only |
| Altitude/heading | ❌ Never | — | Intentionally excluded from hook |

---

## Google OAuth (Future)

The architecture supports Google OAuth but it is **not active** in this prototype.

To enable:
1. Go to Supabase Dashboard → Authentication → Providers → Google
2. Add your Google Cloud OAuth Client ID and Secret
3. Set Authorized redirect URI: `https://your-project.supabase.co/auth/v1/callback`
4. In `useAuth.ts`, call: `supabase.auth.signInWithOAuth({ provider: 'google' })`
5. Add a "Continue with Google" button to SignInForm

---

## File Map

```
weathergpt-web/
├── middleware.ts                      ← session refresh + route protection
├── context/
│   └── AuthContext.tsx                ← global auth state
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  ← browser client
│   │   ├── server.ts                  ← server client (RSC, Route Handlers)
│   │   └── middleware.ts              ← session refresh helper
│   ├── auth/
│   │   └── useAuth.ts                 ← auth hook
│   ├── profile/
│   │   └── profileService.ts          ← CRUD for profile, prefs, locations
│   └── location/
│       ├── useGeolocation.ts          ← GPS hook (on-demand only)
│       └── reverseGeocode.ts          ← Nominatim geocoder
├── components/
│   ├── auth/
│   │   ├── SignUpForm.tsx
│   │   ├── SignInForm.tsx
│   │   └── AuthGuard.tsx
│   └── location/
│       └── LocationPicker.tsx
└── app/
    ├── layout.tsx                     ← AuthProvider wrapper
    ├── login/page.tsx
    ├── signup/page.tsx
    └── dashboard/page.tsx

backend/
├── api/
│   └── chat.py                        ← POST /api/chat (location priority)
├── models/
│   ├── weather.py                     ← WeatherResponse (unchanged)
│   └── chat.py                        ← ChatRequest, ChatResponse
└── main.py                            ← includes chat router

supabase/
└── schema.sql                         ← run once in Supabase SQL Editor

tests/
├── test_weather.py                    ← existing (19 tests, unchanged)
├── test_auth_validation.py            ← new: signup/login validation
├── test_location.py                   ← new: geo state + chat priority
└── test_chat.py                       ← new: /api/chat endpoint
```
