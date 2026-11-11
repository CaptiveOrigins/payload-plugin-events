import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, type Access, type CollectionConfig, type Config, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { events, type EventDoc } from '../src/index.js'

/**
 * A made-up two-site install shaped like a multi-site one: `access.write` answers `true` for a platform admin, a
 * query (`{ site: { in: [...] } }`) for a curator of some sites, and `false` for a member. Each test can swap the
 * rule for another answer and puts it back after.
 */
type Who = { id: unknown; collection: string; role?: string; sites?: string[] }
const siteRule: Access = ({ req }) => {
  const u = req.user as unknown as Who | null
  if (u?.role === 'platform') return true
  if (u?.role === 'curator') return { site: { in: u.sites ?? [] } }
  return false
}
let rule: Access = siteRule
let payload: Payload
let mongo: MongoMemoryReplSet
let platform: Who
let curatorA: Who
let memberUser: Who

const addSite = (): ((c: Config) => Config) => (c) => ({
  ...c,
  collections: c.collections!.map((col: CollectionConfig) => (['events', 'event-dates'].includes(col.slug) ? { ...col, fields: [...col.fields, { name: 'site', type: 'text', index: true }] } : col)),
})

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('events-scoped'), ensureIndexes: true }),
      collections: [{ slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'sites', type: 'text', hasMany: true }] }],
      plugins: [events({ media: false, copyToDates: ['site'], defaultTimezone: 'America/Phoenix', access: { write: (args) => rule(args) } }), addSite()],
    }),
  })
  const mkUser = async (email: string, data: Record<string, unknown>) =>
    ({ ...(await payload.create({ collection: 'users', data: { email, password: 'correct-horse-battery', ...data } as never })), collection: 'users' }) as unknown as Who
  platform = await mkUser('platform@example.invalid', { role: 'platform' })
  curatorA = await mkUser('curator-a@example.invalid', { role: 'curator', sites: ['a'] })
  memberUser = await mkUser('member@example.invalid', { role: 'member' })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

const endpoint = (path: string) => (payload.collections.events!.config.endpoints as Endpoint[]).find((e) => e.path === path)!
const call = async (path: string, who: Who | null, data: Record<string, unknown> = {}, id?: unknown) => {
  const req = (await createLocalReq({ user: who as never }, payload)) as PayloadRequest
  req.user = who as never
  req.data = data as never
  req.routeParams = id === undefined ? {} : { id: String(id) }
  return endpoint(path).handler(req)
}
const mk = (name: string, site: string, data: Record<string, unknown> = {}) =>
  payload.create({ collection: 'events', data: { name, site, _status: 'published', ...data } as never, draft: false }) as unknown as Promise<EventDoc>
const mkDate = (event: EventDoc, n: number) =>
  payload.create({ collection: 'event-dates', data: { event: event.id, starts: `2031-0${n}-01T17:00:00Z` } as never }) as unknown as Promise<{ id: string }>
const exists = async (id: unknown) => (await payload.count({ collection: 'events', where: { id: { equals: id } } })).totalDocs === 1
const nameOf = async (id: unknown) => ((await payload.findByID({ collection: 'events', id: id as string, depth: 0 })) as unknown as EventDoc).name
const datesOf = async (id: unknown) => (await payload.count({ collection: 'event-dates', where: { event: { equals: id } } })).totalDocs
const answering = async (answer: () => unknown, body: () => Promise<void>) => {
  rule = answer as Access
  try {
    await body()
  } finally {
    rule = siteRule
  }
}

describe('a write rule that returns a query scopes the endpoints (2026-11-11)', () => {
  it('lets a curator of site A arrange an event of site A, and not one of site B', async () => {
    const a = await mk('Curator A show', 'a', { reusable: true })
    await mkDate(a, 1)
    await mkDate(a, 2)
    const res = await call('/:id/arrange', curatorA, { allIndividual: true, apply: true }, a.id)
    expect(await res.json()).toMatchObject({ applied: true })
    expect(await datesOf(a.id)).toBe(1)

    const b = await mk('Site B show', 'b', { reusable: true })
    await mkDate(b, 1)
    await mkDate(b, 2)
    await expect(call('/:id/arrange', curatorA, { allIndividual: true, apply: true }, b.id)).rejects.toMatchObject({ status: 404 })
    await expect(call('/:id/arrange', curatorA, { allIndividual: true }, b.id)).rejects.toMatchObject({ status: 404 }) // not even a plan
    expect(await datesOf(b.id)).toBe(2)
  })

  it('lets a curator merge site A events, and refuses any merge that touches site B, either way round', async () => {
    const into = await mk('Curator merge into', 'a')
    const from = await mk('Curator merge from', 'a')
    const res = await call('/merge', curatorA, { into: into.id, from: [from.id], apply: true })
    expect(await res.json()).toMatchObject({ applied: true })
    expect(await exists(from.id)).toBe(false)

    const a2 = await mk('Curator A keeps', 'a')
    const b1 = await mk('Site B keeps', 'b')
    const b2 = await mk('Site B keeps too', 'b')
    for (const body of [
      { into: a2.id, from: [b1.id] },
      { into: b1.id, from: [a2.id] },
      { into: b1.id, from: [b2.id] },
      { into: a2.id, from: [a2.id, b1.id] },
    ])
      await expect(call('/merge', curatorA, { ...body, apply: true }), JSON.stringify(body)).rejects.toMatchObject({ status: 404 })
    for (const id of [a2.id, b1.id, b2.id]) expect(await exists(id)).toBe(true)
    // Marking "not a duplicate" across sites writes to both events, so it's refused too.
    await expect(call('/:id/not-duplicate', curatorA, { of: b1.id }, a2.id)).rejects.toMatchObject({ status: 404 })
    expect(((await payload.findByID({ collection: 'events', id: b1.id, depth: 0 })) as unknown as EventDoc).notDuplicateOf ?? []).toEqual([])
  })

  it('lets a platform admin (true) work on any site, and refuses a member (false) with 403', async () => {
    const b1 = await mk('Platform merge into', 'b')
    const b2 = await mk('Platform merge from', 'b')
    expect(await (await call('/merge', platform, { into: b1.id, from: [b2.id], apply: true })).json()).toMatchObject({ applied: true })
    const a = await mk('Member target', 'a')
    await expect(call('/:id/arrange', memberUser, { allIndividual: true }, a.id)).rejects.toMatchObject({ status: 403 })
    await expect(call('/merge', memberUser, { into: a.id, from: [b1.id] })).rejects.toMatchObject({ status: 403 })
  })
})

describe('only true or a real query from the write rule counts (2026-11-11)', () => {
  // Each a no: truthy values that aren't true, an empty query (it would match every event), an array, and errors.
  const noes: [string, () => unknown][] = [
    ['1', () => 1],
    ["'yes'", () => 'yes'],
    ['{}', () => ({})],
    ['an array', () => [{ site: { in: ['a'] } }]],
    ['a thrown error', () => {
      throw new Error('directory down')
    }],
    ['a rejected promise', async () => {
      throw new Error('directory down')
    }],
  ]

  it('refuses every endpoint with 403, never a 500, and changes nothing', async () => {
    const a = await mk('Noes into', 'a')
    const b = await mk('Noes from', 'a')
    for (const [label, answer] of noes)
      await answering(answer, async () => {
        for (const [path, data, id] of [
          ['/merge', { into: a.id, from: [b.id], apply: true }, undefined],
          ['/:id/arrange', { allIndividual: true, apply: true }, a.id],
          ['/:id/not-duplicate', { of: b.id }, a.id],
          ['/similar', { name: 'Noes' }, undefined],
          ['/preview-rule', { rule: {} }, undefined],
        ] as const)
          await expect(call(path, platform, data, id), `${label} ${path}`).rejects.toMatchObject({ status: 403 })
      })
    expect(await exists(a.id)).toBe(true)
    expect(await exists(b.id)).toBe(true)
  })

  it('refuses collection writes with 403 and shows no drafts, without a 500', async () => {
    const a = await mk('Noes collection target', 'a')
    const draft = (await payload.create({ collection: 'events', data: { name: 'Noes draft', site: 'a', _status: 'draft' } as never, draft: true })) as unknown as EventDoc
    const as = { overrideAccess: false, user: platform as never }
    for (const [label, answer] of noes)
      await answering(answer, async () => {
        await expect(payload.create({ collection: 'events', data: { name: 'Uninvited', site: 'a' } as never, ...as }), label).rejects.toMatchObject({ status: 403 })
        await expect(payload.update({ collection: 'events', id: a.id, data: { name: 'Changed' } as never, ...as }), label).rejects.toMatchObject({ status: 403 })
        await expect(payload.delete({ collection: 'events', id: a.id, ...as }), label).rejects.toMatchObject({ status: 403 })
        expect((await payload.count({ collection: 'events', where: { id: { equals: draft.id } }, ...as })).totalDocs, label).toBe(0)
      })
    expect(await nameOf(a.id)).toBe('Noes collection target')
    // A real query still scopes drafts: site A's draft for a site A curator, nothing for site B's.
    const count = async (who: Who) => (await payload.count({ collection: 'events', where: { id: { equals: draft.id } }, overrideAccess: false, user: who as never })).totalDocs
    expect(await count(curatorA)).toBe(1)
    expect(await count({ ...curatorA, sites: ['b'] })).toBe(0)
  })
})
