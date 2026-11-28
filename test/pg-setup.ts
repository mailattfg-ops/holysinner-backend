// `npm run test:pg`: starts a throwaway real Postgres (embedded-postgres: no Docker, nothing installed system-wide),
// points the tests at it through DATABASE_URL, and deletes it afterwards. PGlite runs one transaction at a time,
// so only a real server can show whether row locks and lock order hold when tills race each other.
import EmbeddedPostgres from 'embedded-postgres'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)) })
})

export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'holysinner-pg-'))
  const port = await freePort()
  const pg = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'), user: 'postgres', password: 'test', port, persistent: false, onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // as on Supabase; Windows would otherwise pick WIN1252 and reject "₹"
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('holysinner_test')
  process.env.DATABASE_URL = `postgres://postgres:test@127.0.0.1:${port}/holysinner_test`
  process.env.JWT_SECRET = 'race-tests-only-secret-0123456789abcdef' // a real DB needs a non-dev key (env.ts)
  return async () => {
    await pg.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
