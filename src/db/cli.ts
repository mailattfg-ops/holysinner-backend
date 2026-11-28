// npm run db:migrate | db:seed
import { dbKind, migrate } from '.'
import { env } from '../env'
import { DEMO_PIN, seed } from './seed'

const cmd = process.argv[2]
if (cmd === 'migrate') {
  await migrate()
  console.log(`migrations applied (${dbKind})`)
} else if (cmd === 'seed') {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production')
  // The demo users (Owner included) all have PIN 1234 and public phone numbers: never load them into a real
  // database by accident. A remote (Supabase) seed needs the flag spelled out.
  if (env.DATABASE_URL && !process.argv.includes('--remote')) {
    throw new Error('DATABASE_URL is set: refusing to load demo users (PIN 1234) into that database. Unset it for local PGlite, or add --remote if you really mean it.')
  }
  await seed()
  console.log(`demo data seeded (${dbKind}); every demo user's PIN is ${DEMO_PIN}`)
} else {
  throw new Error('usage: cli.ts migrate|seed')
}
process.exit(0)
