import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Config, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { events, type EventDateDoc, type EventDoc } from '../src/index.js'

/** A made-up install that leaves `defaultTimezone` out, so the plugin's own default, `UTC`, is used (2026-11-11). */
let payload: Payload
let mongo: MongoMemoryReplSet

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      admin: { user: 'users' },
      db: mongooseAdapter({ url: mongo.getUri('events-utc'), ensureIndexes: true }),
      collections: [{ slug: 'users', auth: true, fields: [] }],
      plugins: [events({ media: false })],
    }),
  })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('the default timezone (2026-11-11)', () => {
  it('lets a site with no defaultTimezone create events, one-time and repeating, and their dates, in UTC', async () => {
    const once = (await payload.create({ collection: 'events', data: { name: 'Adoption day', _status: 'published' } as never, draft: false })) as unknown as EventDoc
    const date = (await payload.create({ collection: 'event-dates', data: { event: once.id, starts: new Date(Date.now() + 30 * 86_400_000).toISOString() } as never })) as unknown as EventDateDoc
    expect(date.timezone).toBe('UTC')
    const from = new Date().toISOString().slice(0, 10)
    const repeating = (await payload.create({
      collection: 'events',
      data: { name: 'Monthly meeting', _status: 'published', recurring: true, rule: { every: 1, unit: 'month', monthly: 'weekdayOfMonth', setPos: '3', weekday: 'TH', time: '19:00', durationMinutes: 120, ends: 'never', from } } as never,
      draft: false,
    })) as unknown as EventDoc & { rule?: { timezone?: string } }
    expect(repeating.rule?.timezone).toBe('UTC')
    const made = (await payload.find({ collection: 'event-dates', where: { event: { equals: repeating.id } }, limit: 1, depth: 0 })).docs as unknown as EventDateDoc[]
    expect(made[0]?.timezone).toBe('UTC')
  })

  it('refuses at start-up a defaultTimezone the timezone field can’t hold, in plain words', () => {
    const config = { collections: [] } as unknown as Config
    expect(() => events({ media: false, defaultTimezone: 'Mars/Olympus_Mons' })(config)).toThrow('events: defaultTimezone "Mars/Olympus_Mons" isn’t in the timezone list')
    expect(() => events({ media: false, defaultTimezone: 'Europe/London' })(config)).not.toThrow()
  })
})
