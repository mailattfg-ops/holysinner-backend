import { defineConfig } from 'vitest/config'

// Race tests against a real, throwaway Postgres (see test/pg-setup.ts). One file at a time on one database.
export default defineConfig({
  test: {
    include: ['test/**/*.pg.test.ts'],
    globalSetup: ['test/pg-setup.ts'],
    setupFiles: ['test/setup.ts'],
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
