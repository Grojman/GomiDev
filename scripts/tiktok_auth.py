"""One-time helper: get a TikTok refresh token for the TIKTOK_REFRESH_TOKEN secret.

    TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... python scripts/tiktok_auth.py

1. Open the printed URL, log in with the TikTok account and accept.
2. TikTok redirects to the redirect URI with ?code=...&state=... in the address bar.
3. Paste that whole URL (or just the code) here; the refresh token is printed.

The redirect URI must be registered exactly in the TikTok app (Login Kit → Redirect URI).
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.parse
import urllib.request

REDIRECT_URI = os.environ.get("TIKTOK_REDIRECT_URI", "https://gomidev.es/")
SCOPES = "user.info.basic,video.list"


def main() -> None:
    key, secret = os.environ.get("TIKTOK_CLIENT_KEY"), os.environ.get("TIKTOK_CLIENT_SECRET")
    if not (key and secret):
        sys.exit("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET first.")

    state = secrets.token_urlsafe(16)
    query = urllib.parse.urlencode(
        {"client_key": key, "scope": SCOPES, "response_type": "code", "redirect_uri": REDIRECT_URI, "state": state}
    )
    print(f"\nOpen this URL and authorize the app:\n\nhttps://www.tiktok.com/v2/auth/authorize/?{query}\n")

    answer = input("Paste the URL you were redirected to (or the code): ").strip()
    params = urllib.parse.parse_qs(urllib.parse.urlparse(answer).query)
    if params:
        if params.get("state", [None])[0] != state:
            sys.exit("State mismatch; start again.")
        code = params["code"][0]
    else:
        code = urllib.parse.unquote(answer)

    body = urllib.parse.urlencode(
        {
            "client_key": key,
            "client_secret": secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
        }
    ).encode()
    req = urllib.request.Request(
        "https://open.tiktokapis.com/v2/oauth/token/",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        token = json.loads(resp.read())
    if "refresh_token" not in token:
        sys.exit(f"Token exchange failed: {token}")

    days = token.get("refresh_expires_in", 0) // 86400
    print(f"\nTIKTOK_REFRESH_TOKEN (valid ~{days} days, granted scopes: {token.get('scope')}):\n")
    print(token["refresh_token"])


if __name__ == "__main__":
    main()
