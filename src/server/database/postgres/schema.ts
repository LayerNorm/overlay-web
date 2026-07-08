import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const overlayAppDataMetadata = pgTable('overlay_app_data_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
