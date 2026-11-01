"""
One TLS context for every outbound httpx client.

Building an ``httpx.AsyncClient`` without ``verify=`` loads the certifi CA
bundle synchronously (about 0.6 s on Windows), which blocks the event loop for
every concurrent request. Reuse this context instead: ``verify=SSL_CONTEXT``.
"""

import ssl

import certifi

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
