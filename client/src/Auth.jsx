import { useState } from "react"

const API_BASE = "/api"

/**
 * Форма логіну/реєстрації. Викликає onAuth(user) після успіху —
 * сесія тримається на httpOnly-кукі, тут нічого зберігати не треба.
 */
export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login") // "login" | "register"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${API_BASE}/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не вдалося увійти")
      onAuth(data)
    } catch (e2) {
      setError(e2.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1>🎵 YTM Player</h1>
      <h3>{mode === "login" ? "Вхід" : "Реєстрація"}</h3>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          style={{ padding: 8 }}
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль (мін. 6 символів)"
          style={{ padding: 8 }}
        />
        {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: 8 }}>
          {loading ? "…" : mode === "login" ? "Увійти" : "Зареєструватись"}
        </button>
      </form>
      <p style={{ marginTop: 12, fontSize: 13 }}>
        {mode === "login" ? "Немає акаунта? " : "Вже є акаунт? "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setMode(mode === "login" ? "register" : "login")
            setError("")
          }}
        >
          {mode === "login" ? "Зареєструватись" : "Увійти"}
        </a>
      </p>
    </div>
  )
}
