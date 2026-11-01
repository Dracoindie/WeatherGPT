"""
Startup checks for backend environment variable names.

The frontend (Next.js) reads ``NEXT_PUBLIC_SUPABASE_URL`` and
``NEXT_PUBLIC_SUPABASE_ANON_KEY``. The backend reads ``SUPABASE_URL`` and
``SUPABASE_ANON_KEY``, without the prefix. Copying the frontend file into
``backend/.env`` is an easy mistake: the backend then silently runs without
Supabase (no trusted default location, no alert job).

We never accept the prefixed names as a fallback (``NEXT_PUBLIC_*`` values
are meant to be public, and quietly reading them would blur which process
owns which secret). Instead we log a warning telling the user to rename them.
Values are never logged, only variable names.
"""

from __future__ import annotations

import logging
import os
from typing import Mapping, Optional

logger = logging.getLogger("weathergpt.env")

# backend name -> frontend name that is often pasted by mistake
PREFIXED_ALIASES = {
    "SUPABASE_URL": "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_ANON_KEY": "NEXT_PUBLIC_SUPABASE_ANON_KEY",
}


def misnamed_env_vars(env: Optional[Mapping[str, str]] = None) -> list[tuple[str, str]]:
    """(expected, found) pairs where only the NEXT_PUBLIC_ name is set."""
    env = os.environ if env is None else env
    return [
        (name, prefixed)
        for name, prefixed in PREFIXED_ALIASES.items()
        if not (env.get(name) or "").strip() and (env.get(prefixed) or "").strip()
    ]


def warn_misnamed_env_vars(env: Optional[Mapping[str, str]] = None) -> list[tuple[str, str]]:
    """Log one warning per misnamed variable. Returns the pairs for tests."""
    pairs = misnamed_env_vars(env)
    for name, prefixed in pairs:
        logger.warning(
            "%s is not set, but %s is. The backend does not read NEXT_PUBLIC_ names: "
            "rename it to %s in backend/.env (or the host's environment). "
            "Until then Supabase features (trusted default location, alert job) are off.",
            name,
            prefixed,
            name,
        )
    return pairs
