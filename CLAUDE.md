# YTM Player — контекст проєкту

Особистий плеєр для плейлистів YouTube Music. Два сервіси:

```
client/  React (Vite) — UI, плеєр через YouTube IFrame API
server/  Express (:4000) — /api/playlist/:id, /api/search, /api/saved-playlists
```

Раніше був третій сервіс, `python-service/` (Flask + `ytmusicapi`, browser-auth
через кукі), для автоматичного сканування всієї бібліотеки плейлистів
користувача. **Видалено повністю** — був надто крихким (сесія/кукі постійно
"протухали", auto-refresh через headless Playwright сам ламав сесію, Google
міг тимчасово "притлумлювати" навіть валідну сесію). З'ясувалось, що
завантаження треків за ID плейлиста (`/api/playlist/:id`) працює **анонімно**,
без жодної авторизації — тому весь функціонал зберігся через "Збережені
плейлисти" (нижче), просто без автосканування бібліотеки одним кліком; нові
плейлисти додаються вручну за ID з URL `music.youtube.com/playlist?list=...`.

### Юзери й авторизація (email + пароль)

Багатокористувацький застосунок з **PostgreSQL** (`server/db/schema.sql`,
`server/db/index.js`). Таблиці: `users` (email, bcrypt-хеш пароля),
`saved_playlists` (FK `user_id`, `UNIQUE(user_id, playlist_id)`),
`saved_mixes` (FK `user_id`, `tracks` — JSONB), `session` (стандартна схема
`connect-pg-simple` — сесії теж у Postgres, не in-memory).

`server/index.js`: `express-session` + `connect-pg-simple`, httpOnly-кукі
`sameSite: lax`, 30 днів. Роути:
- `POST /api/auth/register` `{email, password}` — bcrypt-хеш, одразу логінить
- `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`
- Усі `/api/saved-playlists*` і `/api/mixes*` — за `requireAuth`, завжди
  фільтруються по `req.session.userId` (WHERE user_id = $1 у кожному запиті)

Клієнт: `client/src/Auth.jsx` — форма логін/реєстрація (перемикач режиму).
`App.jsx` на маунті робить `GET /api/auth/me`; якщо 401 — показує `<Auth>`,
інакше застосунок як є + email/"Вийти" в шапці. Усі fetch-виклики йдуть
через `apiFetch()` (App.jsx) — обгортка з `credentials: "include"`, щоб
сесійна кука летіла разом із запитом (через Vite/nginx проксі це й так
той самий origin, але credentials:"include" явний і безпечний за замовчуванням).

`GET/POST /api/playlist/:id` (сам пошук/завантаження треків) лишається
**анонімним** — не потребує логіну, бо YouTube Music плейлисти доступні за
ID без авторизації, як "непублічне посилання". Це навмисно не за
`requireAuth` — фронт все одно ховає весь UI за логіном.

**Стара файлова версія** (`server/data/playlists.json` / `mixes.json`,
без юзерів, одна спільна "на всіх" купа даних) — замінена цією схемою.
Файли лишились на диску (гітігнорнуті) для одноразового переносу:
`server/scripts/migrate-json-to-db.js your@email.com` (юзер має бути вже
зареєстрований) — вставляє записи в БД під нього
(`ON CONFLICT DO NOTHING` на плейлистах, тому safe re-run).

### Кросфейд між треками (client/src/Player.jsx)

Два YouTube IFrame-плеєри (A/B), що чергуються. За `crossfadeSeconds`
(дефолт 20с, регулюється повзунком в UI, зберігається в `localStorage`)
до кінця активного треку підвантажується наступний у другий плеєр і грає
паралельно, поки гучності лінійно зводяться (крок 200мс). Кожен фізичний
плеєр (слот 0/1) ще має свій power-повзунок гучності (0-100, `volumes` state
в Player.jsx) — це "стеля", яку рамп кросфейду поважає (множить на неї, а не
на жорсткі 100).

`Player` приймає `queue` (videoId від поточного, з циклічним wraparound на
перший трек — App.jsx) і сам вирішує: кросфейд (для природного просування)
чи hard-cut (⏮/⏭/клік по черзі/перемішування — визначається `crossfadedRef`:
якщо просування ІНІЦІЙОВАНЕ кросфейдом, ре-завантаження не потрібне, бо активний
слот уже грає; інакше — зовнішній стрибок, перезавантажуємо активний плеєр).

**Тестувати реальне відтворення через claude-in-chrome тут не вдалось** —
YouTube-відео застрягає в `BUFFERING` (state 3) в автоматизованому
Chrome-середовищі (не пов'язано з кодом — навіть порожній плеєр не міг
завантажити метадані жодного відео). Механізм кросфейду перевірено ізольовано
(Node.js, фейкові плеєри) — тайминг/стейт-машина коректні. Якщо колись
знадобиться реальна перевірка — робити руками в звичайному вікні Chrome
(не automation), бо потрібен прямий клік по iframe-кнопці Play для зняття
autoplay-блокування.

### Мікс двох плейлистів (App.jsx)

Блок "🎛 Мікс двох плейлистів" — обираєш плейлист А і Б зі збережених
(рендеряться в різних кольорах: А — червоний `#ffe3e3`, Б — блакитний
`#e0f0ff`), клікаєш по треках → вони йдуть у "Результат" зі своїм кольором.
Обраний трек сіріє й недоступний для повторного кліку, поки не прибрати
його з результату (відстежується по індексу в межах КОНКРЕТНОГО обраного
плейлиста — `_sourceListId`, а не по videoId, щоб коректно розрізняти
дублікати треків).

"🎲 Згенерувати плейлист" — поля "По скільки з А/Б" (0-10), чергує порції
з початку кожного списку, зупиняється, щойно якийсь список не може дати
повну наступну порцію.

Результат можна зберегти як окремий "мікс" (`GET/POST/DELETE /api/mixes`,
таблиця `saved_mixes`), бо це не ID реального плейлиста, а конкретний набір
треків (JSONB). У черзі відтворення збереженого міксу кожен трек має
кольорову смужку зліва за походженням (`t._origin`).

## Запуск локально (Windows/PowerShell)

```powershell
# postgres (тільки БД в docker, сервер/клієнт — звичайний dev)
docker compose up -d postgres

# server
cd server
npm start                                # :4000, потребує DATABASE_URL в .env

# client
cd client
npm run dev                              # :5173, Vite HMR
```

## Docker

`docker-compose.yml` у корені — три сервіси:
- `postgres` — `postgres:16-alpine`, volume `pg-data`, healthcheck
  (`pg_isready`), `127.0.0.1:5432`. `server` чекає `service_healthy` перед
  стартом (`depends_on.condition`).
- `server` — Node, `server/Dockerfile`, :4000, `DATABASE_URL`/`SESSION_SECRET`
  через `environment:` у compose (не .env-файл — простіше для контейнера).
  На старті сам ганяє `server/db/schema.sql` (ретраї на випадок, якщо
  Postgres ще не зовсім готовий, хоча healthcheck це й так покриває).
- `client` — multi-stage: `npm run build` → статика в `nginx:alpine`
  (`client/nginx.conf`), :80 (мапиться на хост :8080). `location /api/`
  проксить на `http://server:4000/api/` — ім'я сервісу в docker-мережі, не
  `localhost` (на відміну від Vite dev-проксі в `vite.config.js`).

Порти `4000`/`8080`/`5432` прив'язані до **`127.0.0.1`**, не `0.0.0.0` —
ззовні контейнери недосяжні напряму, єдина зовнішня точка входу — хостовий
nginx (`deploy/nginx.conf`, розділ нижче).

```bash
docker compose up -d --build   # підняти всі три контейнери
docker compose down            # зупинити (volume pg-data лишається — дані юзерів цілі)
```

⚠️ **Docker і локальний dev не можуть працювати одночасно** — обидва хочуть
порти 4000/8080(5173). Перед `docker compose up` зупини `npm start`/`npm run dev`
(і навпаки). Можна тримати лише `postgres` в docker і сервер/клієнт локально
(команди вище) — це не конфліктує.

Перевірено повний auth-флоу через docker compose (усі три контейнери):
register/login/logout/me через cookie-сесію, ізоляція даних між двома
юзерами (401 без сесії, 409 на дубль email, 401 на невірний пароль),
`migrate-json-to-db.js` (14 плейлистів + 2 мікси перенеслись), і той самий
флоу в браузері (форма логіну → застосунок → вихід → форма знову).

## Розгортання на VPS

Раніше опублікований план (Artifact:
https://claude.ai/artifact/RHHRTF8nfujfQi4ujBiJVc) описує **три** systemd-служби
включно з python-service — **застарілий**, ігноруй. Актуальний шлях:

0. ⚠️ Заміни `SESSION_SECRET=change-me-in-production` і
   `POSTGRES_PASSWORD=ytm` у `docker-compose.yml` на реальні секрети перед
   деплоєм — зараз там dev-плейсхолдери.
1. На VPS: встанови Docker + Docker Compose, склонуй репозиторій.
2. `docker compose up -d --build` — підніме postgres, server (:4000) і
   client (:8080), усе тільки на `127.0.0.1`.
3. Встанови хостовий nginx (`sudo apt install nginx`), онови плейсхолдер
   домену/IP у `deploy/nginx.conf`, постав як показано в коментарях файлу
   (`sites-available` → symlink → `nginx -t` → `reload`).
4. Фаєрвол: `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`
   — порти 4000/8080 назовні не відкривати (і так прив'язані лише до localhost).
5. HTTPS (якщо є домен): `certbot --nginx -d домен` — інструкція в коментарі
   `deploy/nginx.conf`.

`browser.json`/`playwright_state.json`/python-service з того старого плану
більше не існують — авторизація YouTube Music не потрібна взагалі
(`/api/playlist/:id` анонімний, дивись розділ вище).
