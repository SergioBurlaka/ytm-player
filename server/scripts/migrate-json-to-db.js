/**
 * Одноразовий перенос старих server/data/playlists.json та mixes.json
 * (файлове сховище "на всіх") у Postgres під конкретного вже зареєстрованого
 * юзера. Юзера створюй заздалегідь через POST /api/auth/register.
 *
 * Запуск:
 *   DATABASE_URL=postgres://ytm:ytm@localhost:5432/ytm node scripts/migrate-json-to-db.js your@email.com
 */
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { pool, migrate } from "../db/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const email = process.argv[2]?.trim().toLowerCase()

if (!email) {
  console.error("Використання: node scripts/migrate-json-to-db.js your@email.com")
  process.exit(1)
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

async function main() {
  await migrate()

  const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [email])
  const user = userResult.rows[0]
  if (!user) {
    console.error(`Юзера з email ${email} не знайдено — спершу зареєструй його через застосунок.`)
    process.exit(1)
  }

  const playlists = await readJson(path.join(__dirname, "..", "data", "playlists.json"))
  const mixes = await readJson(path.join(__dirname, "..", "data", "mixes.json"))

  let importedPlaylists = 0
  for (const p of playlists) {
    const r = await pool.query(
      `INSERT INTO saved_playlists (user_id, playlist_id, name, added_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, playlist_id) DO NOTHING`,
      [user.id, p.id, p.name, p.addedAt || new Date().toISOString()]
    )
    importedPlaylists += r.rowCount
  }

  let importedMixes = 0
  for (const m of mixes) {
    await pool.query(
      `INSERT INTO saved_mixes (user_id, name, tracks, created_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, m.name, JSON.stringify(m.tracks), m.createdAt || new Date().toISOString()]
    )
    importedMixes++
  }

  console.log(
    `Перенесено для ${email}: ${importedPlaylists}/${playlists.length} плейлистів, ${importedMixes}/${mixes.length} міксів.`
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
