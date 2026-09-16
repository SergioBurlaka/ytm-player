import pg from "pg"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function migrate() {
  const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf-8")
  await pool.query(schema)
}
