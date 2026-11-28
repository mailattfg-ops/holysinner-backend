import { beforeAll } from 'vitest'
import { migrate } from '../src/db'

// Each test file gets its own in-memory PGlite database (NODE_ENV=test), migrated fresh.
beforeAll(() => migrate())
