import { useEffect, useState } from "react"
import Player from "./Player.jsx"

const API_BASE = "/api"

export default function App() {
  const [playlistId, setPlaylistId] = useState("")
  const [tracks, setTracks] = useState([])
  const [order, setOrder] = useState([]) // масив індексів tracks -> визначає порядок відтворення
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [library, setLibrary] = useState(null) // null = ще не завантажували
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState("")
  const [showReseed, setShowReseed] = useState(false)
  const [fetchText, setFetchText] = useState("")
  const [reseedLoading, setReseedLoading] = useState(false)
  const [reseedStatus, setReseedStatus] = useState("")
  const [savedPlaylists, setSavedPlaylists] = useState([])
  const [savedError, setSavedError] = useState("")
  const [newSavedId, setNewSavedId] = useState("")
  const [savingId, setSavingId] = useState(false)

  useEffect(() => {
    loadSavedPlaylists()
  }, [])

  async function loadSavedPlaylists() {
    try {
      const res = await fetch(`${API_BASE}/saved-playlists`)
      if (!res.ok) throw new Error("Не вдалося отримати збережені плейлисти")
      setSavedPlaylists(await res.json())
    } catch (e) {
      setSavedError(e.message)
    }
  }

  async function savePlaylist(id, name) {
    setSavingId(id)
    setSavedError("")
    try {
      const res = await fetch(`${API_BASE}/saved-playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не вдалося зберегти плейлист")
      setSavedPlaylists((prev) => [...prev, data])
    } catch (e) {
      setSavedError(e.message)
    } finally {
      setSavingId(false)
    }
  }

  async function removeSavedPlaylist(id) {
    try {
      await fetch(`${API_BASE}/saved-playlists/${encodeURIComponent(id)}`, { method: "DELETE" })
      setSavedPlaylists((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      setSavedError(e.message)
    }
  }

  async function loadLibrary() {
    setLibraryLoading(true)
    setLibraryError("")
    try {
      const res = await fetch(`${API_BASE}/library/playlists`)
      if (!res.ok) throw new Error("Не вдалося отримати список плейлистів")
      const data = await res.json()
      setLibrary(data)
    } catch (e) {
      setLibraryError(e.message)
    } finally {
      setLibraryLoading(false)
    }
  }

  async function loadPlaylist() {
    if (!playlistId) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API_BASE}/playlist/${encodeURIComponent(playlistId)}`)
      if (!res.ok) throw new Error("Не вдалося завантажити плейлист (перевір ID / cookie на сервері)")
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Плейлист порожній або не знайдений")
      }
      setTracks(data)
      setOrder(data.map((_, i) => i))
      setCurrent(0)
    } catch (e) {
      setError(e.message)
      setTracks([])
      setOrder([])
    } finally {
      setLoading(false)
    }
  }

  async function reseedSession() {
    if (!fetchText.trim()) return
    setReseedLoading(true)
    setReseedStatus("")
    try {
      const res = await fetch(`${API_BASE}/auth/reseed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fetchText }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не вдалося оновити сесію")
      }
      setReseedStatus("✅ Сесію оновлено")
      setFetchText("")
      setShowReseed(false)
    } catch (e) {
      setReseedStatus(`❌ ${e.message}`)
    } finally {
      setReseedLoading(false)
    }
  }

  function moveTrack(pos, dir) {
    setOrder((prev) => {
      const swapWith = pos + dir
      if (swapWith < 0 || swapWith >= prev.length) return prev
      const next = [...prev]
      ;[next[pos], next[swapWith]] = [next[swapWith], next[pos]]
      return next
    })
  }

  function shuffle() {
    setOrder((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    })
    setCurrent(0)
  }

  function playNext() {
    setCurrent((c) => (order.length ? (c + 1) % order.length : 0))
  }

  function playPrev() {
    setCurrent((c) => (order.length ? (c - 1 + order.length) % order.length : 0))
  }

  const currentTrack = order.length ? tracks[order[current]] : null

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1>🎵 YTM Player</h1>
      <p>
        Встав ID плейлиста з YouTube Music — це частина URL після{" "}
        <code>?list=</code> на сторінці <code>music.youtube.com/playlist?list=...</code>
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={playlistId}
          onChange={(e) => setPlaylistId(e.target.value)}
          placeholder="PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          style={{ flex: 1, padding: 8 }}
          onKeyDown={(e) => e.key === "Enter" && loadPlaylist()}
        />
        <button onClick={loadPlaylist} disabled={!playlistId || loading}>
          {loading ? "Завантаження…" : "Завантажити"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div style={{ marginTop: 16 }}>
        <h3>⭐ Збережені плейлисти</h3>
        <p style={{ color: "#666", fontSize: 13 }}>
          Завантаження за ID не потребує сесії Python-сервісу — надійний спосіб.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newSavedId}
            onChange={(e) => setNewSavedId(e.target.value)}
            placeholder="Встав ID плейлиста, щоб зберегти назавжди"
            style={{ flex: 1, padding: 8 }}
          />
          <button
            onClick={() => {
              const id = newSavedId.trim()
              if (!id) return
              savePlaylist(id).then(() => setNewSavedId(""))
            }}
            disabled={!newSavedId.trim() || savingId === newSavedId.trim()}
          >
            {savingId === newSavedId.trim() ? "Збереження…" : "➕ Додати"}
          </button>
        </div>
        {savedError && <p style={{ color: "crimson" }}>{savedError}</p>}
        {savedPlaylists.length > 0 && (
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            {savedPlaylists.map((pl) => (
              <li key={pl.id} style={{ marginBottom: 4 }}>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setPlaylistId(pl.id)
                    setTimeout(loadPlaylist, 0)
                  }}
                >
                  {pl.name}
                </span>{" "}
                <button onClick={() => removeSavedPlaylist(pl.id)} title="Прибрати">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={loadLibrary} disabled={libraryLoading}>
          {libraryLoading ? "Завантаження…" : "📚 Мої плейлисти (потребує Python-сервіс)"}
        </button>
        {libraryError && <p style={{ color: "crimson" }}>{libraryError}</p>}
        {library && library.length > 0 && (
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            {library.map((pl) => (
              <li key={pl.playlistId} style={{ marginBottom: 4 }}>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setPlaylistId(pl.playlistId)
                    setTimeout(loadPlaylist, 0)
                  }}
                >
                  {pl.title} {pl.count != null ? `(${pl.count})` : ""}
                </span>{" "}
                {!savedPlaylists.some((s) => s.id === pl.playlistId) && (
                  <button
                    onClick={() => savePlaylist(pl.playlistId, pl.title)}
                    disabled={savingId === pl.playlistId}
                    title="Зберегти назавжди"
                  >
                    💾
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={() => setShowReseed((v) => !v)}>
          🔑 Оновити сесію YouTube Music
        </button>
        {showReseed && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: "#666", fontSize: 13 }}>
              У music.youtube.com (залогінений) відкрий DevTools → Network → будь-який
              запит до <code>/browse</code> → правою кнопкою →{" "}
              <strong>Copy → Copy as fetch (Node.js)</strong> → встав сюди:
            </p>
            <textarea
              value={fetchText}
              onChange={(e) => setFetchText(e.target.value)}
              placeholder="fetch(&quot;https://music.youtube.com/youtubei/v1/browse...&quot;, { ... })"
              rows={6}
              style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 12 }}
            />
            <button
              onClick={reseedSession}
              disabled={!fetchText.trim() || reseedLoading}
              style={{ marginTop: 8 }}
            >
              {reseedLoading ? "Оновлення…" : "Зберегти сесію"}
            </button>
          </div>
        )}
        {reseedStatus && <p style={{ marginTop: 8 }}>{reseedStatus}</p>}
      </div>

      {currentTrack && (
        <div style={{ marginTop: 24 }}>
          <h3>
            Зараз грає: {currentTrack.name || currentTrack.title}
            {currentTrack.artist?.name ? ` — ${currentTrack.artist.name}` : ""}
          </h3>
          <Player videoId={currentTrack.videoId} onEnded={playNext} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={playPrev}>⏮ Попередній</button>
            <button onClick={playNext}>⏭ Наступний</button>
            <button onClick={shuffle}>🔀 Перемішати</button>
          </div>
        </div>
      )}

      {tracks.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Черга відтворення ({tracks.length})</h3>
          <ol style={{ paddingLeft: 20 }}>
            {order.map((idx, pos) => {
              const t = tracks[idx]
              return (
                <li key={idx} style={{ marginBottom: 4 }}>
                  <span
                    onClick={() => setCurrent(pos)}
                    style={{
                      cursor: "pointer",
                      fontWeight: pos === current ? "bold" : "normal",
                    }}
                  >
                    {t.name || t.title}
                    {t.artist?.name ? ` — ${t.artist.name}` : ""}
                  </span>{" "}
                  <button onClick={() => moveTrack(pos, -1)} title="Вгору">↑</button>
                  <button onClick={() => moveTrack(pos, 1)} title="Вниз">↓</button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
