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
const SAVED_MIXES_FILE = path.join(__dirname, "data", "mixes.json")

async function readJsonArray(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

async function writeJsonArray(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8")
}

const readSavedPlaylists = () => readJsonArray(SAVED_PLAYLISTS_FILE)
const writeSavedPlaylists = (data) => writeJsonArray(SAVED_PLAYLISTS_FILE, data)
const readSavedMixes = () => readJsonArray(SAVED_MIXES_FILE)
const writeSavedMixes = (data) => writeJsonArray(SAVED_MIXES_FILE, data)

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
 * Збережені плейлисти (id + назва). Завантаження плейлиста за ID (нижче,
 * /api/playlist/:id) працює анонімно — тому досить один раз зберегти ID,
 * і плейлист завжди буде доступний.
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

/**
 * Збережені мікси — конкретний набір треків (з "🎛 Мікс двох плейлистів"),
 * а не ID плейлиста. Зберігаємо самі треки, бо мікс не існує як окремий
 * плейлист на YouTube Music.
 */
app.get("/api/mixes", async (req, res) => {
  try {
    res.json(await readSavedMixes())
  } catch (err) {
    console.error("[/api/mixes] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/mixes", async (req, res) => {
  const name = req.body?.name?.trim()
  const tracks = req.body?.tracks
  if (!name) return res.status(400).json({ error: "Відсутня назва міксу" })
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: "Порожній мікс — нема що зберігати" })
  }
  try {
    const mixes = await readSavedMixes()
    const entry = {
      id: `mix-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name,
      tracks,
      createdAt: new Date().toISOString(),
    }
    mixes.push(entry)
    await writeSavedMixes(mixes)
    res.json(entry)
  } catch (err) {
    console.error("[/api/mixes POST] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/mixes/:id", async (req, res) => {
  try {
    const mixes = await readSavedMixes()
    const next = mixes.filter((m) => m.id !== req.params.id)
    await writeSavedMixes(next)
    res.json({ ok: true })
  } catch (err) {
    console.error("[/api/mixes DELETE] error:", err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/health", (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`YTM player server running on http://localhost:${PORT}`)
})
