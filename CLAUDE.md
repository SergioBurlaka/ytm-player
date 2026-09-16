# YTM Player — контекст проєкту

Особистий плеєр для плейлистів YouTube Music. Три сервіси:

```
client/          React (Vite) — UI, плеєр через YouTube IFrame API
server/          Express (:4000) — /api/playlist/:id, /api/search, проксі до python-service
python-service/  Flask (:5000) — ytmusicapi, приватна бібліотека користувача (плейлисти)
```

### Кросфейд між треками (client/src/Player.jsx)

Два YouTube IFrame-плеєри (A/B), що чергуються. За `crossfadeSeconds` (дефолт 20с)
до кінця активного треку підвантажується наступний у другий плеєр і грає
паралельно, поки гучності лінійно зводяться (100→0 / 0→100, крок 200мс).
`Player` приймає `queue` (videoId від поточного, з циклічним wraparound на
перший трек — App.jsx:161) і сам вирішує: кросфейд (для природного просування)
чи hard-cut (⏮/⏭/клік по черзі/перемішування — визначається `crossfadedRef`:
якщо просування ІНІЦІЙОВАНЕ кросфейдом, ре-завантаження не потрібне, бо активний
слот уже грає; інакше — зовнішній стрибок, перезавантажуємо активний плеєр).

**Тестувати реальне відтворення через claude-in-chrome тут не вдалось** —
YouTube-відео застрягає в `BUFFERING` (state 3) в цьому автоматизованому
Chrome-середовищі (ISOLATED, не пов'язано з кодом — навіть порожній другий
плеєр не міг завантажити метадані). Механізм кросфейду перевірено ізольовано
(Node.js, фейкові плеєри) — тайминг/стейт-машина коректні. Якщо колись
знадобиться реальна перевірка — робити руками в звичайному вікні Chrome
(не automation), бо потрібен прямий клік по iframe-кнопці Play для зняття
autoplay-блокування.

`server/index.js` проксує `/api/library/playlists` і `/api/auth/reseed` до `python-service`
(`PYTHON_SERVICE_URL`, типово `http://localhost:5000`). Клієнт ходить лише в `server` (`/api/...`).

### Збережені плейлисти (обхід крихкого python-service)

`GET/POST /api/playlist/:id` (Node, `server/index.js`) працює **анонімно** —
`server/.env` навіть не містить `YTM_COOKIE`. YouTube Music плейлисти доступні
за ID без авторизації, як "непублічне посилання". Це не залежить від
python-service взагалі.

Тому є `server/data/playlists.json` (гітігнорнутий, автостворюється) —
список `{id, name, addedAt}`, який керується через:
- `GET /api/saved-playlists`
- `POST /api/saved-playlists` `{id, name?}` — якщо `name` не передано,
  сервер сам підтягує назву через `ytmusic-api`'s `getPlaylist(id)` (теж без auth)
- `DELETE /api/saved-playlists/:id`

На фронті — блок "⭐ Збережені плейлисти" (завжди працює) + кнопка "💾" біля
кожного елемента зі старого списку "📚 Мої плейлисти" (той, що залежить від
python-service), щоб один раз зберегти ID і більше не залежати від сесії.
Практичний висновок сесії: **`get_library_playlists()` (python-service) потрібен
лише щоб один раз знайти/підписати ID плейлистів; сам плейбек через нього не
залежить.**

## Автентифікація YouTube Music (найважливіше)

`python-service` використовує **browser-auth** (не OAuth) через два файли:
- `python-service/browser.json` — заголовки (Cookie, Authorization...) для `ytmusicapi`
- `python-service/playwright_state.json` — стан сесії Playwright (cookies)

Обидва — **секрети з живими кукі акаунта**, у `.gitignore`, ніколи не комітити.

### Як (пере)авторизуватись

1. У браузері (залогінений на `music.youtube.com`) DevTools → Network → будь-який
   запит до `/browse` → правою кнопкою → **Copy → Copy as fetch (Node.js)**.
2. Встав текст або:
   - **Кнопка на фронті**: "🔑 Оновити сесію YouTube Music" → вставити текст → зберегти.
     Йде через `POST /api/auth/reseed` (server) → `POST /auth/reseed` (python-service) →
     `auth_refresh.seed_from_fetch_text()`.
   - **Термінал** (той самий код, CLI-обгортка): `venv\Scripts\python.exe auth_refresh.py seed`.

### Відомі проблеми (вирішені цієї сесії)

1. **Auto-refresh ламав сесію.** `app.py` мав фоновий потік
   (`_background_refresh_loop`, `YTM_AUTO_REFRESH`, дефолт `true`, інтервал 600с),
   який через headless Playwright ходив на `/library` і перезаписував кукі.
   Google розпізнавав це як підозрілу активність і повертав "не залогінену"
   відповідь, яку скрипт зберігав як "оновлену" сесію — і сесія помирала по колу.
   **Зараз `YTM_AUTO_REFRESH=false` в `python-service/.env`.** Не вмикай без
   переробки механізму (напр. non-headless Playwright + більший інтервал).

2. **UnicodeEncodeError на Windows.** `auth_refresh.py` робить `print()` з
   кирилицею. Якщо stdout перенаправлено (лог-файл, не жива консоль), Python на
   Windows падає з `'charmap' codec can't encode...` **до** запису `browser.json`
   (тобто `playwright_state.json` встигає оновитись, а `browser.json` — ні,
   і `/auth/reseed` повертає 400). Виправлено в `app.py` (на початку файлу):
   `sys.stdout.reconfigure(encoding="utf-8")` / те саме для `stderr`.

3. **Сесія помирає швидко навіть без auto-refresh** (спостерігалось: робоча
   сесія "померла" за ~15-20 хв самостійно, без жодної зміни файлів). Ймовірно
   через серію повторних автоматизованих API-викликів (debugging) під час
   тестування — Google міг тимчасово "притлумити" сесію. **Не досліджено до
   кінця** — якщо повториться в звичайному використанні (не під час дебагу),
   варто копати глибше (rate limiting, User-Agent з `requests`, IP-репутація).

### Діагностика "чому пусто"

`/library/playlists` мовчки повертає `[]` замість помилки, коли сесія
"неавторизована" на боці Google (типова ознака — не помилка HTTP, а порожній
результат). Швидкий тест напряму, в обхід Flask-кешу клієнта:

```bash
cd python-service
venv/Scripts/python.exe -c "
from ytmusicapi import YTMusic
yt = YTMusic('browser.json')
print(len(yt.get_library_playlists(limit=None)))
print(yt.get_account_info())   # KeyError на 'header' = сесія не залогінена
"
```

Якщо `get_account_info()` кидає `KeyError` на шляху з `activeAccountHeaderRenderer`
— це "гостьове" меню акаунта, сесія мертва → потрібен re-seed.

## Запуск локально (Windows/PowerShell)

```powershell
# python-service
cd python-service
venv\Scripts\python.exe app.py          # :5000

# server
cd server
npm start                                # :4000 (npm run dev = --watch, автоперезапуск)

# client
cd client
npm run dev                              # :5173, Vite HMR
```

⚠️ На Windows фонові процеси, запущені через `command &` у Git Bash, іноді
дублюються (venv `python.exe`-обгортка створює пару PID). Перед повторним
запуском перевіряй і вбивай старі:

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'app\.py' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Розгортання

Повний план (systemd + nginx на Ubuntu VPS) опубліковано як Artifact:
https://claude.ai/artifact/RHHRTF8nfujfQi4ujBiJVc — сід (`seed`) робити
**тільки локально**, ніколи на самому сервері (датацентровий IP виглядає
підозріло для Google).
