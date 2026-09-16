"""
Мінімальний мікросервіс над бібліотекою ytmusicapi (Python).
Використовує browser-автентифікацію, яку auth_refresh.py періодично
оновлює у фоні через живий Playwright-сеанс.
"""

import os
import sys
import time
import threading

# Windows: коли stdout перенаправлено (наприклад, у лог-файл), Python
# падає на print() з кирилицею через cp1252. Примушуємо UTF-8.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from flask import Flask, jsonify, request
from flask_cors import CORS
from ytmusicapi import YTMusic, OAuthCredentials
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

AUTH_FILE = os.environ.get("YTM_AUTH_FILE", "browser.json")
AUTH_MODE = os.environ.get("YTM_AUTH_MODE", "browser")
CLIENT_ID = os.environ.get("YTM_CLIENT_ID")
CLIENT_SECRET = os.environ.get("YTM_CLIENT_SECRET")
AUTO_REFRESH = os.environ.get("YTM_AUTO_REFRESH", "true").lower() == "true"
REFRESH_INTERVAL_SECONDS = int(os.environ.get("YTM_REFRESH_INTERVAL", "600"))

_yt = None
_yt_lock = threading.Lock()


def get_client() -> YTMusic:
    global _yt
    with _yt_lock:
        if _yt is None:
            if AUTH_MODE == "browser":
                _yt = YTMusic(AUTH_FILE)
            else:
                if not CLIENT_ID or not CLIENT_SECRET:
                    raise RuntimeError(
                        "Відсутні YTM_CLIENT_ID / YTM_CLIENT_SECRET у .env."
                    )
                _yt = YTMusic(
                    AUTH_FILE,
                    oauth_credentials=OAuthCredentials(
                        client_id=CLIENT_ID, client_secret=CLIENT_SECRET
                    ),
                )
        return _yt


def _background_refresh_loop():
    from auth_refresh import refresh_browser_json

    while True:
        time.sleep(REFRESH_INTERVAL_SECONDS)
        ok = refresh_browser_json()
        if ok:
            global _yt
            with _yt_lock:
                _yt = None


if AUTH_MODE == "browser" and AUTO_REFRESH:
    threading.Thread(target=_background_refresh_loop, daemon=True).start()


def call_with_retry(fn, *args, retries=5, delay_seconds=1.5, **kwargs):
    last_result = None
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            last_result = fn(*args, **kwargs)
            last_error = None
            if last_result:
                return last_result
        except Exception as e:
            last_error = e
        if attempt < retries:
            time.sleep(delay_seconds)
    if last_error is not None:
        raise last_error
    return last_result


@app.get("/library/playlists")
def library_playlists():
    limit = request.args.get("limit", default=None, type=int)
    yt = get_client()
    playlists = call_with_retry(yt.get_library_playlists, limit=limit)
    return jsonify(playlists)


@app.get("/playlist/<playlist_id>")
def playlist_tracks(playlist_id: str):
    yt = get_client()
    data = call_with_retry(yt.get_playlist, playlist_id)
    return jsonify(data)


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/auth/reseed")
def auth_reseed():
    from auth_refresh import seed_from_fetch_text

    body = request.get_json(silent=True) or {}
    fetch_text = body.get("fetchText", "")
    if not fetch_text.strip():
        return jsonify({"ok": False, "error": "Порожній текст запиту"}), 400

    try:
        ok = seed_from_fetch_text(fetch_text)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Не вдалося розпарсити запит: {e}"}), 400

    if not ok:
        return jsonify({"ok": False, "error": "Не вдалося оновити сесію — перевір, що скопіював запит з логіном"}), 400

    global _yt
    with _yt_lock:
        _yt = None
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(port=5000)