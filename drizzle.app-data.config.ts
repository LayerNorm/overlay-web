import { defineConfig } from 'drizzle-kit'

const connectionString = process.env.OVERLAY_DATABASE_URL

if (!connectionString) {
  throw new Error('OVERLAY_DATABASE_URL is required for app-data Drizzle commands')
}

export default defineConfig({
  schema: './src/server/database/postgres/schema.ts',
  out: './migrations/app-data',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
})
