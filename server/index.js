import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import YTMusic from "ytmusic-api"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAVED_PLAYLISTS_FILE = path.join(__dirname, "data", "playlists.json")

async function readSavedPlaylists() {
  try {
    return JSON.parse(await fs.readFile(SAVED_PLAYLISTS_FILE, "utf-8"))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

async function writeSavedPlaylists(playlists) {
  await fs.mkdir(path.dirname(SAVED_PLAYLISTS_FILE), { recursive: true })
  await fs.writeFile(SAVED_PLAYLISTS_FILE, JSON.stringify(playlists, null, 2), "utf-8")
}

const app = express()
app.use(cors())
app.use(express.json())

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
 * GET /api/library/playlists
 * Проксі до Python-мікросервісу (python-service/app.py), який використовує
 * ytmusicapi.get_library_playlists() — повний список плейлистів користувача.
 * Потребує запущеного `python app.py` на PYTHON_SERVICE_URL (типово :5000).
 */
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:5000"

app.get("/api/library/playlists", async (req, res) => {
  try {
    const r = await fetch(`${PYTHON_SERVICE_URL}/library/playlists`)
    if (!r.ok) throw new Error(`Python service responded ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err) {
    console.error("[/api/library/playlists] error:", err)
    res
      .status(502)
      .json({ error: `Не вдалося дістатись Python-сервісу: ${err.message}` })
  }
})

/**
 * POST /api/auth/reseed
 * Проксі до Python-мікросервіса: приймає текст "Copy as fetch (Node.js)"
 * з DevTools і оновлює browser.json/playwright_state.json на сервері.
 */
app.post("/api/auth/reseed", async (req, res) => {
  try {
    const r = await fetch(`${PYTHON_SERVICE_URL}/auth/reseed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fetchText: req.body?.fetchText || "" }),
    })
    const data = await r.json()
    res.status(r.status).json(data)
  } catch (err) {
    console.error("[/api/auth/reseed] error:", err)
    res
      .status(502)
      .json({ ok: false, error: `Не вдалося дістатись Python-сервісу: ${err.message}` })
  }
})

/**
 * Збережені плейлисти (id + назва), які не залежать від Python-сервісу.
 * Завантаження плейлиста за ID (нижче, /api/playlist/:id) працює анонімно —
 * тому досить один раз зберегти ID, і плейлист завжди буде доступний,
 * навіть якщо сесія Python-сервісу "протухла".
 */
app.get("/api/saved-playlists", async (req, res) => {
  try {
    res.json(await readSavedPlaylists())
  } catch (err) {
    console.error("[/api/saved-playlists] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/saved-playlists", async (req, res) => {
  const id = req.body?.id?.trim()
  if (!id) return res.status(400).json({ error: "Відсутній id плейлиста" })
  try {
    const playlists = await readSavedPlaylists()
    if (playlists.some((p) => p.id === id)) {
      return res.status(409).json({ error: "Цей плейлист уже збережено" })
    }
    let name = req.body?.name?.trim()
    if (!name) {
      const client = await getClient()
      const meta = await client.getPlaylist(id)
      name = meta?.name || id
    }
    const entry = { id, name, addedAt: new Date().toISOString() }
    playlists.push(entry)
    await writeSavedPlaylists(playlists)
    res.json(entry)
  } catch (err) {
    console.error("[/api/saved-playlists POST] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/saved-playlists/:id", async (req, res) => {
  try {
    const playlists = await readSavedPlaylists()
    const next = playlists.filter((p) => p.id !== req.params.id)
    await writeSavedPlaylists(next)
    res.json({ ok: true })
  } catch (err) {
    console.error("[/api/saved-playlists DELETE] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/health", (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`YTM player server running on http://localhost:${PORT}`)
})
