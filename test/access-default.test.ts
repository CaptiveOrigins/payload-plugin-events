import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { events, type EventDoc } from '../src/index.js'

/**
 * A made-up install with no `access` option and two auth collections: `users` (the admin collection) and `members`
 * (people who sign in to the site). Since 2026-11-11 only `users` may change events by default.
 */
let payload: Payload
let mongo: MongoMemoryReplSet
let admin: Record<string, unknown>
let member: Record<string, unknown>

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      admin: { user: 'users' },
      db: mongooseAdapter({ url: mongo.getUri('events-default'), ensureIndexes: true }),
      collections: [
        { slug: 'users', auth: true, fields: [] },
        { slug: 'members', auth: true, fields: [] },
      ],
      plugins: [events({ media: false, defaultTimezone: 'America/Phoenix' })],
    }),
  })
  admin = { ...(await payload.create({ collection: 'users', data: { email: 'admin@example.invalid', password: 'correct-horse-battery' } })), collection: 'users' }
  member = { ...(await payload.create({ collection: 'members' as never, data: { email: 'member@example.invalid', password: 'correct-horse-battery' } as never })), collection: 'members' }
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

const endpoint = (path: string) => (payload.collections.events!.config.endpoints as Endpoint[]).find((e) => e.path === path)!
const call = async (path: string, who: Record<string, unknown> | null, data: Record<string, unknown> = {}, id?: unknown) => {
  const req = (await createLocalReq({ user: who as never }, payload)) as PayloadRequest
  req.user = who as never
  req.data = data as never
  req.routeParams = id === undefined ? {} : { id: String(id) }
  return endpoint(path).handler(req)
}
const mk = (name: string, status: 'draft' | 'published' = 'published') =>
  payload.create({ collection: 'events', data: { name, _status: status } as never, draft: status === 'draft' }) as unknown as Promise<EventDoc>
const exists = async (id: unknown) => (await payload.count({ collection: 'events', where: { id: { equals: id } } })).totalDocs === 1

describe('the default write rule (2026-11-11)', () => {
  it('refuses a member of a second auth collection: no create, edit or delete, and no endpoint', async () => {
    const as = { overrideAccess: false, user: member as never }
    const a = await mk('Member target A')
    const b = await mk('Member target B')
    await expect(payload.create({ collection: 'events', data: { name: 'By a member' } as never, ...as })).rejects.toMatchObject({ status: 403 })
    await expect(payload.update({ collection: 'events', id: a.id, data: { name: 'Changed' } as never, ...as })).rejects.toMatchObject({ status: 403 })
    await expect(payload.delete({ collection: 'events', id: a.id, ...as })).rejects.toMatchObject({ status: 403 })
    await expect(call('/merge', member, { into: a.id, from: [b.id], apply: true })).rejects.toMatchObject({ status: 403 })
    await expect(call('/:id/arrange', member, { allIndividual: true, apply: true }, a.id)).rejects.toMatchObject({ status: 403 })
    await expect(call('/:id/not-duplicate', member, { of: b.id }, a.id)).rejects.toMatchObject({ status: 403 })
    await expect(call('/similar', member, { name: 'Member target' })).rejects.toMatchObject({ status: 403 })
    await expect(call('/preview-rule', member, { rule: {} })).rejects.toMatchObject({ status: 403 })
    expect(await exists(a.id)).toBe(true)
    expect(await exists(b.id)).toBe(true)
    expect(((await payload.findByID({ collection: 'events', id: a.id })) as unknown as EventDoc).name).toBe('Member target A')
  })

  it('shows a member published events only, and an admin the drafts', async () => {
    const draft = await mk('Default draft', 'draft')
    const count = async (who: Record<string, unknown>) =>
      (await payload.count({ collection: 'events', where: { id: { equals: draft.id } }, overrideAccess: false, user: who as never })).totalDocs
    expect(await count(member)).toBe(0)
    expect(await count(admin)).toBe(1)
  })

  it('answers someone not signed in with 401', async () => {
    const a = await mk('Visitor target')
    await expect(call('/merge', null, { into: a.id, from: [a.id] })).rejects.toMatchObject({ status: 401 })
  })

  it('lets a user of the admin collection change events and use the endpoints', async () => {
    const as = { overrideAccess: false, user: admin as never }
    const made = (await payload.create({ collection: 'events', data: { name: 'By an admin', _status: 'published' } as never, ...as })) as unknown as EventDoc
    await payload.update({ collection: 'events', id: made.id, data: { name: 'By an admin, edited' } as never, ...as })
    const other = await mk('Admin merge source')
    const res = await call('/merge', admin, { into: made.id, from: [other.id], apply: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: true })
    expect(await exists(other.id)).toBe(false)
    await payload.delete({ collection: 'events', id: made.id, ...as })
    expect(await exists(made.id)).toBe(false)
  })
})
