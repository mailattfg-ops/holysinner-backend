import { configDefaults, defineConfig } from 'vitest/config'

// *.pg.test.ts need a real Postgres: they run with `npm run test:pg` (vitest.pg.config.ts), not here.
export default defineConfig({ test: { setupFiles: ['test/setup.ts'], env: { NODE_ENV: 'test' }, exclude: [...configDefaults.exclude, 'test/**/*.pg.test.ts'] } })
