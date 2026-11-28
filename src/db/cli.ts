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
  await seed()
  console.log(`demo data seeded (${dbKind}); every demo user's PIN is ${DEMO_PIN}`)
} else {
  throw new Error('usage: cli.ts migrate|seed')
}
process.exit(0)
