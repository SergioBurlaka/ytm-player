"""
Автоматичне підтримання живої сесії YouTube Music через Playwright.

Важливо: Playwright НІКОЛИ сам не логіниться (Google блокує автоматизований
логін як "небезпечний браузер"). Натомість сесія одноразово "засівається"
з тих самих заголовків, які ти копіюєш з DevTools (Copy as fetch), а далі
Playwright просто періодично відвідує сторінки з уже дійсними cookie —
це виглядає як звичайний трафік залогіненого користувача, і саме так
природно підхоплюються ротовані Google-cookie без ручного втручання.

Одноразове налаштування:
    venv\\Scripts\\python.exe auth_refresh.py seed
    (попросить вставити текст "Copy as fetch (Node.js)" з DevTools — той
     самий спосіб, яким ти вже користувався раніше)

Далі app.py сам періодично викликає refresh_browser_json() у фоні.
"""

import json
import time
import hashlib
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE_FILE = Path(__file__).parent / "playwright_state.json"
BROWSER_JSON = Path(__file__).parent / "browser.json"
ORIGIN = "https://music.youtube.com"

GOOGLE_DOMAIN_COOKIES = {
    "SID", "HSID", "SSID", "APISID", "SAPISID",
    "__Secure-1PAPISID", "__Secure-3PAPISID",
    "__Secure-1PSID", "__Secure-3PSID",
    "__Secure-1PSIDTS", "__Secure-3PSIDTS",
    "__Secure-1PSIDCC", "__Secure-3PSIDCC",
}


def _parse_fetch_headers(fetch_text: str) -> dict:
    key = '"headers": {'
    start = fetch_text.index(key) + len('"headers": ')
    depth = 0
    end = start
    for i in range(start, len(fetch_text)):
        if fetch_text[i] == "{":
            depth += 1
        elif fetch_text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return json.loads(fetch_text[start:end])


def _cookie_header_to_playwright_cookies(cookie_header: str) -> list:
    cookies = []
    for part in cookie_header.split("; "):
        if "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        domain = ".google.com" if name in GOOGLE_DOMAIN_COOKIES else ".youtube.com"
        cookies.append({
            "name": name,
            "value": value,
            "domain": domain,
            "path": "/",
            "expires": -1,
            "httpOnly": False,
            "secure": True,
            "sameSite": "Lax",
        })
    return cookies


def seed_from_fetch_text(fetch_text: str) -> bool:
    """Парсить текст 'Copy as fetch (Node.js)' з DevTools і зберігає сесію.

    Повертає True при успіху. Використовується і з CLI (seed_from_devtools_paste),
    і з HTTP-ендпоінта /auth/reseed для кнопки на фронті.
    """
    headers = _parse_fetch_headers(fetch_text)
    cookie_header = headers.get("cookie") or headers.get("Cookie")
    if not cookie_header:
        print("Не знайдено 'cookie' у заголовках — перевір, що скопіював правильний запит.")
        return False

    cookies = _cookie_header_to_playwright_cookies(cookie_header)
    STATE_FILE.write_text(
        json.dumps({"cookies": cookies, "origins": []}, indent=2),
        encoding="utf-8",
    )
    print(f"Збережено початкову сесію у {STATE_FILE}")
    return refresh_browser_json()


def seed_from_devtools_paste():
    print("Встав текст, скопійований через 'Copy as fetch (Node.js)' у DevTools "
          "(запит до /browse на music.youtube.com), потім Enter, далі Ctrl+Z і Enter (Windows):")
    lines = []
    try:
        while True:
            lines.append(input())
    except EOFError:
        pass
    fetch_text = "\n".join(lines)
    seed_from_fetch_text(fetch_text)


def _sapisidhash(sapisid: str, origin: str) -> str:
    timestamp = int(time.time())
    raw = f"{timestamp} {sapisid} {origin}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return f"SAPISIDHASH {timestamp}_{digest}"


def refresh_browser_json() -> bool:
    if not STATE_FILE.exists():
        print("[auth_refresh] Немає збереженої сесії. Спершу запусти: "
              "python auth_refresh.py seed")
        return False

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(storage_state=str(STATE_FILE))
            page = context.new_page()
            page.goto(f"{ORIGIN}/library", wait_until="networkidle", timeout=30000)

            cookies = context.cookies()
            context.storage_state(path=str(STATE_FILE))
            browser.close()

        cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        sapisid = next(
            (c["value"] for c in cookies if c["name"] in ("__Secure-3PAPISID", "SAPISID")),
            None,
        )
        if not sapisid:
            print("[auth_refresh] Не знайдено SAPISID у cookie — сесія недійсна?")
            return False

        headers = {
            "Accept": "*/*",
            "Authorization": _sapisidhash(sapisid, ORIGIN),
            "Content-Type": "application/json",
            "X-Goog-AuthUser": "0",
            "x-origin": ORIGIN,
            "Cookie": cookie_header,
        }
        BROWSER_JSON.write_text(json.dumps(headers, indent=4), encoding="utf-8")
        print("[auth_refresh] browser.json оновлено.")
        return True
    except Exception as e:
        print(f"[auth_refresh] Не вдалось оновити: {e}")
        return False


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "seed":
        seed_from_devtools_paste()
    else:
        refresh_browser_json()