"""
Web Push sender (VAPID).

Sends with ``pywebpush`` (pinned in requirements.txt). If it is missing or the
VAPID keys are not set, the sender reports itself unavailable and the alert job
records "disabled" instead of sending. Configuration (see docs/EARLY_WARNING.md
for generating the keys):

  VAPID_PUBLIC_KEY   base64url public key (also given to the browser)
  VAPID_PRIVATE_KEY  base64url private key (server only)
  VAPID_SUBJECT      mailto: or https: contact, e.g. mailto:ops@example.org
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Literal, Optional

logger = logging.getLogger(__name__)

SendStatus = Literal["sent", "gone", "failed", "disabled"]
SEND_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class VapidConfig:
    public_key: str
    private_key: str
    subject: str

    @classmethod
    def from_env(cls) -> Optional["VapidConfig"]:
        pub, priv = os.getenv("VAPID_PUBLIC_KEY", ""), os.getenv("VAPID_PRIVATE_KEY", "")
        subject = os.getenv("VAPID_SUBJECT", "")
        if not (pub and priv and subject):
            return None
        return cls(pub, priv, subject)


def pywebpush_installed() -> bool:
    try:
        import pywebpush  # noqa: F401
    except ImportError:
        return False
    return True


class WebPushSender:
    def __init__(self, config: Optional[VapidConfig]):
        self.config = config

    @property
    def available(self) -> bool:
        return self.config is not None and pywebpush_installed()

    def send(self, endpoint: str, p256dh: str, auth: str, payload: dict) -> SendStatus:
        if not self.available:
            return "disabled"
        from pywebpush import WebPushException, webpush

        assert self.config is not None
        try:
            webpush(
                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                data=json.dumps(payload),
                vapid_private_key=self.config.private_key,
                vapid_claims={"sub": self.config.subject},
                ttl=6 * 3600,
                timeout=SEND_TIMEOUT_S,
            )
            return "sent"
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                return "gone"  # the browser unsubscribed
            logger.warning("Web push failed (%s): %s", status, exc)
            return "failed"
        except Exception as exc:  # network errors, bad keys: retry next run, don't stop the job
            logger.warning("Web push failed: %s", exc)
            return "failed"
