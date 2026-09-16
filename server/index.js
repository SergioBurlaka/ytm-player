import "dotenv/config" // має виконатись до import "./db/index.js", інакше DATABASE_URL ще порожній
import express from "express"
import cors from "cors"
import session from "express-session"
import connectPgSimple from "connect-pg-simple"
import bcrypt from "bcryptjs"
import YTMusic from "ytmusic-api"
import { pool, migrate } from "./db/index.js"

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

const PgSession = connectPgSimple(session)
app.use(
  session({
    store: new PgSession({ pool, tableName: "session" }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 днів
    },
  })
)

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Потрібна авторизація" })
  next()
}

const PORT = process.env.PORT || 4000

let clientPromise = null

/**
 * Лінива ініціалізація клієнта ytmusic-api (робиться один раз і кешується).
 */
function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const ytmusic = new YTMusic()
      await ytmusic.initialize(
        process.env.YTM_COOKIE ? { cookies: process.env.YTM_COOKIE } : undefined
      )
      return ytmusic
    })()
  }
  return clientPromise
}

/**
 * Реєстрація / логін / логаут / поточний юзер. Пароль хешується bcrypt,
 * сесія зберігається в Postgres (таблиця session, керує connect-pg-simple),
 * id сесії йде клієнту в httpOnly-кукі.
 */
app.post("/api/auth/register", async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase()
  const password = req.body?.password
  if (!email || !password) return res.status(400).json({ error: "Потрібні email і пароль" })
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль має бути не менше 6 символів" })
  }
  try {
    const hash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hash]
    )
    const user = result.rows[0]
    req.session.userId = user.id
    req.session.email = user.email
    res.json({ id: user.id, email: user.email })
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Юзер з таким email вже зареєстрований" })
    }
    console.error("[/api/auth/register] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/auth/login", async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase()
  const password = req.body?.password
  if (!email || !password) return res.status(400).json({ error: "Потрібні email і пароль" })
  try {
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email]
    )
    const user = result.rows[0]
    const ok = user && (await bcrypt.compare(password, user.password_hash))
    if (!ok) return res.status(401).json({ error: "Невірний email або пароль" })
    req.session.userId = user.id
    req.session.email = user.email
    res.json({ id: user.id, email: user.email })
  } catch (err) {
    console.error("[/api/auth/login] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid")
    res.json({ ok: true })
  })
})

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Не залогінений" })
  res.json({ id: req.session.userId, email: req.session.email })
})

/**
 * GET /api/playlist/:id
 * Повертає список треків плейлиста за його ID.
 * ID береться з URL music.youtube.com/playlist?list=ТУТ_ID
 */
app.get("/api/playlist/:id", async (req, res) => {
  try {
    const client = await getClient()
    const tracks = await client.getPlaylistVideos(req.params.id)
    res.json(tracks)
  } catch (err) {
    console.error("[/api/playlist] error:", err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/search?q=запит
 * Пошук пісень — зручно, щоб знайти videoId, якщо треку немає в плейлисті.
 */
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q
    if (!q) return res.status(400).json({ error: "Missing q param" })
    const client = await getClient()
    const results = await client.searchSongs(String(q))
    res.json(results)
  } catch (err) {
    console.error("[/api/search] error:", err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Збережені плейлисти конкретного юзера (id + назва). Завантаження плейлиста
 * за ID (вище, /api/playlist/:id) працює анонімно — тому досить один раз
 * зберегти ID, і плейлист завжди буде доступний саме цьому юзеру.
 */
app.get("/api/saved-playlists", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT playlist_id AS id, name, added_at AS "addedAt"
       FROM saved_playlists WHERE user_id = $1 ORDER BY added_at`,
      [req.session.userId]
    )
    res.json(r.rows)
  } catch (err) {
    console.error("[/api/saved-playlists] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/saved-playlists", requireAuth, async (req, res) => {
  const id = req.body?.id?.trim()
  if (!id) return res.status(400).json({ error: "Відсутній id плейлиста" })
  try {
    let name = req.body?.name?.trim()
    if (!name) {
      const client = await getClient()
      const meta = await client.getPlaylist(id)
      name = meta?.name || id
    }
    const r = await pool.query(
      `INSERT INTO saved_playlists (user_id, playlist_id, name)
       VALUES ($1, $2, $3)
       RETURNING playlist_id AS id, name, added_at AS "addedAt"`,
      [req.session.userId, id, name]
    )
    res.json(r.rows[0])
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Цей плейлист уже збережено" })
    }
    console.error("[/api/saved-playlists POST] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/saved-playlists/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM saved_playlists WHERE user_id = $1 AND playlist_id = $2", [
      req.session.userId,
      req.params.id,
    ])
    res.json({ ok: true })
  } catch (err) {
    console.error("[/api/saved-playlists DELETE] error:", err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Збережені мікси конкретного юзера — конкретний набір треків (з
 * "🎛 Мікс двох плейлистів"), а не ID плейлиста. Зберігаємо самі треки,
 * бо мікс не існує як окремий плейлист на YouTube Music.
 */
app.get("/api/mixes", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, tracks, created_at AS "createdAt"
       FROM saved_mixes WHERE user_id = $1 ORDER BY created_at`,
      [req.session.userId]
    )
    res.json(r.rows)
  } catch (err) {
    console.error("[/api/mixes] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/mixes", requireAuth, async (req, res) => {
  const name = req.body?.name?.trim()
  const tracks = req.body?.tracks
  if (!name) return res.status(400).json({ error: "Відсутня назва міксу" })
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: "Порожній мікс — нема що зберігати" })
  }
  try {
    const r = await pool.query(
      `INSERT INTO saved_mixes (user_id, name, tracks)
       VALUES ($1, $2, $3)
       RETURNING id, name, tracks, created_at AS "createdAt"`,
      [req.session.userId, name, JSON.stringify(tracks)]
    )
    res.json(r.rows[0])
  } catch (err) {
    console.error("[/api/mixes POST] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/mixes/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM saved_mixes WHERE user_id = $1 AND id = $2", [
      req.session.userId,
      req.params.id,
    ])
    res.json({ ok: true })
  } catch (err) {
    console.error("[/api/mixes DELETE] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/health", (req, res) => res.json({ ok: true }))

async function start() {
  const maxAttempts = 10
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await migrate()
      break
    } catch (err) {
      if (attempt === maxAttempts) throw err
      console.log(`[db] Postgres ще не готовий (спроба ${attempt}/${maxAttempts}), чекаю 2с…`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  app.listen(PORT, () => {
    console.log(`YTM player server running on http://localhost:${PORT}`)
  })
}

start()
