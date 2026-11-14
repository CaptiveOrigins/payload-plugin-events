import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createLocalReq, getPayload, type CollectionConfig, type Config, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { configToSchema } from '@payloadcms/graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { arrangeDates, dropOffDates, eventBySlug, eventCalendar, events, findSimilar, mergeEvents, nearbyDates, topUpRecurring, type EventDateDoc, type EventDoc } from '../src/index.js'

/**
 * A made-up two-site install: `site` is copied from events to their dates, appearances are on except on site "b",
 * a fake gazetteer knows three postal codes, and a date whose notes say "booked" is protected.
 */
let payload: Payload
let mongo: MongoMemoryReplSet
let user: { id: string }
const geocoded: string[] = []
const POINTS: Record<string, [number, number]> = { '85001': [-112.07, 33.45], '85201': [-111.83, 33.42], '87101': [-106.65, 35.08] }

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
      db: mongooseAdapter({ url: mongo.getUri('events'), ensureIndexes: true }),
      collections: [{ slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }] }],
      plugins: [
        events({
          media: false,
          copyToDates: ['site'],
          defaultTimezone: 'America/Phoenix',
          appearances: { label: 'Our team will be there', enabled: ({ data }) => (data as { site?: string } | undefined)?.site !== 'b' },
          geocode: async ({ venue }) => {
            geocoded.push(String(venue.postalCode))
            const p = POINTS[String(venue.postalCode)]
            return p ? { lng: p[0], lat: p[1] } : null
          },
          protectDate: ({ date }) => (String(date.notes ?? '').includes('booked') ? 'Kits are booked for this date.' : null),
          // Staff write everywhere; a member signs in but writes nothing.
          access: { write: ({ req }) => Boolean(req.user) && (req.user as { role?: string }).role !== 'member' },
        }),
        addSite(),
      ],
    }),
  })
  user = (await payload.create({ collection: 'users', data: { email: 'staff@example.invalid', password: 'correct-horse-battery' } })) as unknown as { id: string }
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

const as = async () => {
  const req = (await createLocalReq({ user: { ...user, collection: 'users' } as never }, payload)) as PayloadRequest
  return req
}
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
const mkEvent = (data: Record<string, unknown>) => payload.create({ collection: 'events', data: { _status: 'published', site: 'a', ...data } as never, draft: false }) as unknown as Promise<EventDoc>
const datesOf = async (event: unknown) =>
  (await payload.find({ collection: 'event-dates', where: { event: { equals: event } }, sort: 'starts', limit: 0, pagination: false, depth: 0 })).docs as unknown as (EventDateDoc & { slot?: string })[]
const mkDate = (event: EventDoc, data: Record<string, unknown> = {}) =>
  payload.create({ collection: 'event-dates', data: { event: event.id, starts: new Date(Date.now() + 30 * 86_400_000).toISOString(), ...data } as never }) as unknown as Promise<EventDateDoc>
const monthly = { every: 1, unit: 'month', monthly: 'weekdayOfMonth', setPos: '3', weekday: 'TH', time: '19:00', durationMinutes: 120, ends: 'never', timezone: 'America/Phoenix' }

describe('recurring events', () => {
  it('makes a year of dates from the rule, in the event’s timezone, carrying the site and the appearance', async () => {
    const e = await mkEvent({ name: 'Desert Tortoise Club monthly meeting', type: 'meeting', recurring: true, rule: { ...monthly, from: day(0) } })
    expect(e.reusable).toBe(true) // recurring implies reusable
    expect(String(e.ruleSummary)).toMatch(/^Every month on the 3rd Thursday at 19:00/)
    const ds = await datesOf(e.id)
    expect(ds.length).toBeGreaterThanOrEqual(11)
    expect(ds.length).toBeLessThanOrEqual(13)
    for (const d of ds) {
      expect(d).toMatchObject({ source: 'rule', site: 'a', appearance: true, timezone: 'America/Phoenix', status: 'scheduled' })
      expect(new Date(d.starts).getUTCHours()).toBe(2) // 19:00 Phoenix (UTC-7) is 02:00 UTC the next day
      expect(new Date(d.starts).getUTCDay()).toBe(5)
    }
    expect(ds[0]!.title).toMatch(/^Desert Tortoise Club monthly meeting · /)
    // A nightly top-up makes nothing new when nothing is missing.
    expect((await topUpRecurring(payload)).created).toBe(0)
  })

  it('redoes untouched future dates when the rule changes, and never touches edited, protected, hand-made or past dates', async () => {
    const e = await mkEvent({ name: 'Herp Society', type: 'meeting', recurring: true, rule: { ...monthly, from: day(0) } })
    let ds = await datesOf(e.id)
    const edited = await payload.update({ collection: 'event-dates', id: ds[0]!.id, data: { notes: 'Room 4 this time' } as never })
    expect(edited.edited).toBe(true)
    await payload.update({ collection: 'event-dates', id: ds[1]!.id, data: { notes: 'booked' } as never }) // also edited
    const protectedUntouched = ds[2]!
    await payload.update({ collection: 'event-dates', id: protectedUntouched.id, data: { notes: 'booked' } as never, context: { eventsInternal: true } })
    const manual = await mkDate(e, { notes: 'extra social' })
    const past = await payload.create({ collection: 'event-dates', data: { event: e.id, starts: new Date(Date.now() - 40 * 86_400_000).toISOString(), source: 'rule', slot: 'x', generatedBy: 'old' } as never, context: { eventsInternal: true } })

    await payload.update({ collection: 'events', id: e.id, data: { rule: { ...monthly, from: day(0), weekday: 'TU' } } as never })
    ds = await datesOf(e.id)
    const ids = ds.map((d) => d.id)
    for (const keep of [edited.id, ds.find((d) => d.notes === 'booked')!.id, protectedUntouched.id, manual.id, past.id]) expect(ids).toContain(keep)
    const regenerated = ds.filter((d) => d.source === 'rule' && !d.edited && d.id !== protectedUntouched.id && d.id !== past.id)
    expect(regenerated.length).toBeGreaterThan(5)
    for (const d of regenerated) expect(new Date(d.starts).getUTCDay()).toBe(3) // Tuesday 19:00 Phoenix = Wednesday 02:00 UTC

    // Not recurring any more: the untouched future dates go, the rest stay.
    await payload.update({ collection: 'events', id: e.id, data: { recurring: false } as never })
    const left = (await datesOf(e.id)).map((d) => d.id)
    expect(left.sort()).toEqual([edited.id, ds.find((d) => d.notes === 'booked' && d.edited)!.id, protectedUntouched.id, manual.id, past.id].map(String).sort())
  })

  it('refuses to publish a half-built rule, but lets a draft keep one', async () => {
    await expect(mkEvent({ name: 'Broken', recurring: true, rule: { unit: 'month', monthly: 'weekdayOfMonth' } })).rejects.toThrow(/isn’t finished/)
    const draft = await payload.create({ collection: 'events', data: { name: 'Half-built', recurring: true, rule: { unit: 'week' }, _status: 'draft' } as never, draft: true })
    expect((await datesOf(draft.id)).length).toBe(0)
  })
})

describe('dates', () => {
  it('lets a one-time event have one date, and a reusable one many', async () => {
    const once = await mkEvent({ name: 'Adoption day', type: 'adoption-day' })
    await mkDate(once)
    await expect(mkDate(once)).rejects.toThrow(/one date/)
    const many = await mkEvent({ name: 'All American Reptile Expo', type: 'show', reusable: true, appearsByDefault: false })
    await mkDate(many)
    const second = await mkDate(many)
    expect(second.appearance).toBe(false) // the event said new dates start unticked
  })

  it('needs an appearance for drop-off, and turns both off where appearances are off', async () => {
    const e = await mkEvent({ name: 'Swap meet', reusable: true })
    const d = await mkDate(e)
    expect(d.appearance).toBe(true)
    await expect(payload.update({ collection: 'event-dates', id: d.id, data: { appearance: false, dropOff: true } as never })).rejects.toThrow(/Drop-off needs someone there/)
    const ok = await payload.update({ collection: 'event-dates', id: d.id, data: { dropOff: true } as never })
    expect(ok.dropOff).toBe(true)
    const off = await payload.update({ collection: 'event-dates', id: d.id, data: { appearance: false } as never })
    expect(off.dropOff).toBe(false)

    const other = await mkEvent({ name: 'Other site show', reusable: true, site: 'b' })
    const od = await mkDate(other, { appearance: true, dropOff: true })
    expect([od.appearance, od.dropOff]).toEqual([false, false])
    await expect(mkDate(e, { starts: '2030-01-02T10:00:00Z', ends: '2030-01-01T10:00:00Z' })).rejects.toThrow(/end is before/)
  })

  it('looks up the venue’s point when the venue changes, keeps a typed point, and uses the usual venue', async () => {
    geocoded.length = 0
    const e = await mkEvent({ name: 'Venue test', reusable: true, defaultVenue: { name: 'Hall', postalCode: '85001' } })
    const d = await mkDate(e)
    expect(d.venue?.postalCode).toBe('85001')
    expect(d.location).toEqual([-112.07, 33.45])
    await payload.update({ collection: 'event-dates', id: d.id, data: { notes: 'no venue change' } as never })
    expect(geocoded).toEqual(['85001'])
    const moved = await payload.update({ collection: 'event-dates', id: d.id, data: { venue: { postalCode: '85201' } } as never })
    expect(moved.location).toEqual([-111.83, 33.42])
    const typed = await payload.update({ collection: 'event-dates', id: d.id, data: { venue: { postalCode: '99999' }, location: [-110, 32] } as never })
    expect(typed.location).toEqual([-110, 32])
  })

  it('gives each event a slug of its own within its site, and deletes its dates with it unless one is protected', async () => {
    const a1 = await mkEvent({ name: 'Reptile Night' })
    const a2 = await mkEvent({ name: 'Reptile Night' })
    const b1 = await mkEvent({ name: 'Reptile Night', site: 'b' })
    expect([a1.slug, a2.slug, b1.slug]).toEqual(['reptile-night', 'reptile-night-2', 'reptile-night'])
    await mkDate(a1)
    await payload.delete({ collection: 'events', id: a1.id })
    expect((await datesOf(a1.id)).length).toBe(0)
    await mkDate(a2, { notes: 'booked' })
    await expect(payload.delete({ collection: 'events', id: a2.id })).rejects.toThrow(/Kits are booked/)
  })
})

describe('access', () => {
  it('shows visitors only published events and their dates, and refuses their writes', async () => {
    const draft = await payload.create({ collection: 'events', data: { name: 'Secret planning', site: 'a', _status: 'draft' } as never, draft: true })
    await payload.create({ collection: 'event-dates', data: { event: draft.id, starts: new Date().toISOString() } as never })
    const seen = await payload.find({ collection: 'events', overrideAccess: false, user: null, limit: 0, pagination: false })
    expect(seen.docs.map((d) => (d as unknown as EventDoc).name)).not.toContain('Secret planning')
    const ds = await payload.find({ collection: 'event-dates', overrideAccess: false, user: null, where: { event: { equals: draft.id } } })
    expect(ds.totalDocs).toBe(0)
    await expect(payload.create({ collection: 'events', data: { name: 'Spam' } as never, overrideAccess: false, user: null })).rejects.toThrow()
    const req = (await createLocalReq({}, payload)) as PayloadRequest
    req.user = null
    req.routeParams = { id: String(draft.id) }
    const ep = (payload.collections.events!.config.endpoints as Endpoint[]).find((e) => e.path === '/:id/ics')!
    expect((await ep.handler(req)).status).toBe(404)
    const merge = (payload.collections.events!.config.endpoints as Endpoint[]).find((e) => e.path === '/merge')!
    await expect(merge.handler(req)).rejects.toThrow(/can’t change events/)
  })
})

describe('access for signed-in people', () => {
  it('shows a member only published events and their dates, and staff the drafts too', async () => {
    const member = { ...((await payload.create({ collection: 'users', data: { email: 'member@example.invalid', password: 'correct-horse-battery', role: 'member' } as never })) as object), collection: 'users' }
    const staff = { ...user, collection: 'users' }
    const draft = await payload.create({ collection: 'events', data: { name: 'Members-only draft', site: 'a', _status: 'draft' } as never, draft: true })
    await payload.create({ collection: 'event-dates', data: { event: draft.id, starts: new Date().toISOString() } as never })
    const read = async (who: object, collection: 'events' | 'event-dates', where: object) =>
      (await payload.find({ collection, overrideAccess: false, user: who as never, where: where as never, draft: true, limit: 0, pagination: false })).totalDocs
    expect(await read(member, 'events', { id: { equals: draft.id } })).toBe(0)
    expect(await read(member, 'event-dates', { event: { equals: draft.id } })).toBe(0)
    expect(await read(staff, 'events', { id: { equals: draft.id } })).toBe(1)
    expect(await read(staff, 'event-dates', { event: { equals: draft.id } })).toBe(1)
    const published = await mkEvent({ name: 'Open day' })
    await mkDate(published)
    expect(await read(member, 'events', { id: { equals: published.id } })).toBe(1)
    expect(await read(member, 'event-dates', { event: { equals: published.id } })).toBe(1)
  })
})

describe('copied fields', () => {
  it('always takes them from the event: a date can’t claim another site, on create, on an edit or by moving', async () => {
    const a = await mkEvent({ name: 'Site A show', site: 'a', reusable: true })
    const b = await mkEvent({ name: 'Site B show', site: 'b', reusable: true })
    const d = await mkDate(a, { site: 'b' })
    expect((d as unknown as { site: string }).site).toBe('a')
    const edited = await payload.update({ collection: 'event-dates', id: d.id, data: { site: 'b' } as never })
    expect((edited as unknown as { site: string }).site).toBe('a')
    const moved = await payload.update({ collection: 'event-dates', id: d.id, data: { event: b.id, site: 'a' } as never })
    expect((moved as unknown as { site: string }).site).toBe('b')
  })
})

describe('duplicates', () => {
  it('finds overlaps by name, organizer, website or venue, asks the right question, and remembers a no', async () => {
    const one = await mkEvent({ name: 'Tucson Reptile Expo 2026', organizer: 'Desert Herps', website: 'https://www.tucsonexpo.example/2026' })
    const many = await mkEvent({ name: 'Mesa Herp Swap', reusable: true })
    await mkDate(many, { venue: { name: 'Mesa Hall', postalCode: '85201' }, starts: '2031-03-01T17:00:00Z' })
    const where = { site: { equals: 'a' } }
    const byName = await findSimilar(payload, { name: 'Tucson Reptile Expo 2027' }, { where })
    expect(byName.map((m) => m.id)).toContain(String(one.id))
    expect(byName.find((m) => m.id === String(one.id))!.question).toMatch(/Make “Tucson Reptile Expo 2026” reusable/)
    expect((await findSimilar(payload, { name: 'Spring Show', organizer: 'desert herps ' }, { where }))[0]).toMatchObject({ id: String(one.id), reasons: ['organizer'] })
    expect((await findSimilar(payload, { name: 'Spring Show', website: 'https://tucsonexpo.example/' }, { where }))[0]!.reasons).toEqual(['website'])
    const byVenue = await findSimilar(payload, { name: 'Saturday thing', venue: { postalCode: '85201' }, starts: '2031-03-01T20:00:00Z' }, { where })
    expect(byVenue[0]).toMatchObject({ id: String(many.id), reasons: ['venue'] })
    expect(byVenue[0]!.question).toMatch(/Add this date to “Mesa Herp Swap” instead/)
    expect(await findSimilar(payload, { name: 'Tucson Reptile Expo 2027', notDuplicateOf: [one.id] }, { where })).toEqual([])
    expect(await findSimilar(payload, { name: 'Completely different' }, { where })).toEqual([])
  })

  it('remembers “It’s a different event” on both events once the new one is saved', async () => {
    const old = await mkEvent({ name: 'Flagstaff Herp Fair' })
    const fresh = await mkEvent({ name: 'Flagstaff Herp Fair', notDuplicateOf: [old.id] })
    const back = (await payload.findByID({ collection: 'events', id: old.id, depth: 0 })) as unknown as EventDoc
    expect((back.notDuplicateOf ?? []).map(String)).toEqual([String(fresh.id)])
    expect(await findSimilar(payload, { name: 'Flagstaff Herp Fair', id: String(old.id), notDuplicateOf: back.notDuplicateOf }, { where: { site: { equals: 'a' } } })).toEqual([])
  })
})

describe('merge and split', () => {
  it('plans first, then splits dates into new events, keeping each date’s id', async () => {
    const e = await mkEvent({ name: 'AARE', type: 'show', reusable: true, organizer: 'AARE' })
    const [d1, d2, d3, d4] = await Promise.all([1, 2, 3, 4].map((n) => mkDate(e, { starts: `2031-0${n}-01T17:00:00Z` })))
    const req = await as()
    const plan = await arrangeDates(req, { event: String(e.id), buckets: [{ name: 'AARE Phoenix', dates: [String(d2!.id), String(d3!.id)] }] })
    expect(plan).toMatchObject({ applied: false, newEvents: 1, moves: 2, summary: '1 new event, 2 dates move.' })
    expect((await datesOf(e.id)).length).toBe(4) // nothing changed
    const done = await arrangeDates(req, { event: String(e.id), buckets: [{ name: 'AARE Phoenix', dates: [String(d2!.id), String(d3!.id)] }], apply: true })
    expect(done.applied).toBe(true)
    const phoenix = (await payload.find({ collection: 'events', where: { name: { equals: 'AARE Phoenix' } } })).docs[0] as unknown as EventDoc
    expect(phoenix).toMatchObject({ reusable: true, organizer: 'AARE', site: 'a' })
    expect((await datesOf(phoenix.id)).map((d) => d.id).sort()).toEqual([d2!.id, d3!.id].sort())
    expect((await datesOf(e.id)).map((d) => d.id).sort()).toEqual([d1!.id, d4!.id].sort())

    const all = await arrangeDates(req, { event: String(e.id), allIndividual: true, apply: true })
    expect(all.summary).toBe('1 new event, 1 date moves.')
    expect((await datesOf(e.id)).length).toBe(1)
  })

  it('refuses a split that would move a protected date, or a date the rule would remake', async () => {
    const e = await mkEvent({ name: 'Booked show', reusable: true })
    const d = await mkDate(e, { notes: 'booked' })
    await mkDate(e)
    const res = await arrangeDates(await as(), { event: String(e.id), buckets: [{ dates: [String(d.id)] }], apply: true })
    expect(res).toMatchObject({ applied: false, refused: [expect.stringMatching(/Kits are booked/)] })
    const r = await mkEvent({ name: 'Monthly thing', recurring: true, rule: { ...monthly, from: day(0) } })
    const gen = (await datesOf(r.id))[0]!
    const res2 = await arrangeDates(await as(), { event: String(r.id), buckets: [{ dates: [String(gen.id)] }], apply: true })
    expect(res2.refused[0]).toMatch(/Turn off “Recurring” first/)
  })

  it('merges single events into one reusable event whose address the old ones lead to', async () => {
    const into = await mkEvent({ name: 'Phoenix Reptile Expo' })
    const a = await mkEvent({ name: 'Phoenix Reptile Expo Spring' })
    const b = await mkEvent({ name: 'Phoenix Reptile Expo Fall' })
    const [x, y, z] = [await mkDate(into), await mkDate(a), await mkDate(b)]
    const req = await as()
    const plan = await mergeEvents(req, { into: String(into.id), from: [String(a.id), String(b.id)] })
    expect(plan.summary).toBe('2 events merge into “Phoenix Reptile Expo”; 2 dates move; their addresses lead to it.')
    await mergeEvents(req, { into: String(into.id), from: [String(a.id), String(b.id)], apply: true })
    expect((await datesOf(into.id)).map((d) => d.id).sort()).toEqual([x.id, y.id, z.id].sort())
    expect((await payload.find({ collection: 'events', where: { id: { in: [a.id, b.id] } } })).totalDocs).toBe(0)
    const found = await eventBySlug(payload, a.slug)
    expect(found).toMatchObject({ redirect: into.slug })
    expect(found.event!.id).toBe(into.id)
    // A merged-away address isn't handed out again.
    expect((await mkEvent({ name: 'Phoenix Reptile Expo Spring' })).slug).toBe('phoenix-reptile-expo-spring-2')

    const single = await mkEvent({ name: 'Phoenix Reptile Expo Winter' })
    expect((await mergeEvents(req, { into: String(into.id), from: [String(single.id)] })).summary).toBe('1 event merges into “Phoenix Reptile Expo”; 0 dates move; its address leads to it.')
    const other = await mkEvent({ name: 'Other site', site: 'b' })
    expect((await mergeEvents(req, { into: String(into.id), from: [String(other.id)], apply: true })).refused[0]).toMatch(/different site/)
  })
})

describe('the admin’s rule preview', () => {
  it('words a finished rule with its next dates, and lists what an unfinished one is missing', async () => {
    const ep = (payload.collections.events!.config.endpoints as Endpoint[]).find((e) => e.path === '/preview-rule')!
    const call = async (rule: unknown) => {
      const req = await as()
      req.data = { rule } as never
      return (await (await ep.handler(req)).json()) as { problems: string[]; summary?: string; next?: string[] }
    }
    const ok = await call({ ...monthly, from: '2027-01-15T12:00:00.000Z', every: 2 })
    expect(ok.summary).toBe('Every 2 months on the 3rd Thursday at 19:00, from 15 January 2027')
    expect(ok.next).toHaveLength(6)
    expect((await call({ unit: 'month', monthly: 'weekdayOfMonth' })).problems).toEqual(expect.arrayContaining(['Choose which weekday of the month.', 'Choose a start time.']))
  })
})

describe('near me and drop-off', () => {
  it('finds scheduled dates near a point, nearest first, and drop-off dates only inside the window', async () => {
    const e = await mkEvent({ name: 'Near test', reusable: true, site: 'n' })
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
    const phx = await mkDate(e, { starts: soon(30), venue: { postalCode: '85001' }, dropOff: true })
    const mesa = await mkDate(e, { starts: soon(31), venue: { postalCode: '85201' }, dropOff: true })
    await mkDate(e, { starts: soon(32), venue: { postalCode: '87101' }, dropOff: true }) // Albuquerque, ~330 miles
    await mkDate(e, { starts: soon(5), venue: { postalCode: '85001' }, dropOff: true }) // too soon to post a kit
    await mkDate(e, { starts: soon(33), venue: { postalCode: '85001' }, status: 'canceled' })
    await mkDate(e, { starts: soon(34), venue: { postalCode: '85001' }, appearance: false })
    const near = await nearbyDates(payload, { lng: -111.9, lat: 33.4, miles: 50, from: new Date(), to: new Date(Date.now() + 60 * 86_400_000), where: { site: { equals: 'n' } } })
    // Mesa is nearest; Phoenix twice (the soon one counts here, it's only too soon for drop-off); not Albuquerque,
    // not the canceled one. The unticked-appearance date is still a date.
    expect(near[0]!.date.id).toBe(mesa.id)
    expect(near.map((n) => n.date.id)).toContain(phx.id)
    expect(near).toHaveLength(4)
    expect(near.every((n) => n.date.status === 'scheduled' && n.miles < 50)).toBe(true)
    expect(near[0]!.miles).toBeGreaterThan(3)
    expect(near[0]!.miles).toBeLessThan(10)
    const drop = await dropOffDates(payload, { lng: -111.9, lat: 33.4, where: { site: { equals: 'n' } } })
    expect(drop.map((n) => n.date.id).sort()).toEqual([phx.id, mesa.id].sort())
  })
})

describe('calendar files', () => {
  it('gives a recurring event one entry with its rule, leaving out changed dates and adding them back', async () => {
    const e = await mkEvent({ name: 'Club; meeting, monthly', recurring: true, rule: { ...monthly, from: day(0), timezone: 'America/New_York' }, defaultVenue: { name: 'Library', city: 'Boston' } })
    const ds = await datesOf(e.id)
    await payload.update({ collection: 'event-dates', id: ds[1]!.id, data: { status: 'canceled' } as never })
    const later = (iso: string) => new Date(new Date(iso).getTime() + 86_400_000).toISOString()
    await payload.update({ collection: 'event-dates', id: ds[2]!.id, data: { starts: later(ds[2]!.starts), ends: later(ds[2]!.ends!) } as never })
    const fresh = (await payload.findByID({ collection: 'events', id: e.id })) as unknown as EventDoc
    const text = eventCalendar(fresh, await datesOf(e.id), { uidDomain: 'site.example' })
    expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/)
    expect(text).toMatch(/RRULE:FREQ=MONTHLY;(INTERVAL=1;)?BYDAY=\+3TH/)
    // DTSTART is the first real 3rd Thursday, not the rule's start day.
    const first = /DTSTART;TZID=America\/New_York:(\d{4})(\d{2})(\d{2})/.exec(text)!
    expect(new Date(Date.UTC(+first[1]!, +first[2]! - 1, +first[3]!)).getUTCDay()).toBe(4)
    expect(text).toMatch(/DTSTART;TZID=America\/New_York:\d{8}T190000/)
    expect(text).toMatch(/EXDATE;TZID=America\/New_York:\d{8}T190000,\d{8}T190000/)
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2) // the rule, and the moved date
    expect(text).toContain('SUMMARY:Club\\; meeting\\, monthly')
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('lists a reusable event’s dates', async () => {
    const e = await mkEvent({ name: 'Expo', reusable: true, summary: 'A long description '.repeat(10) })
    await mkDate(e, { starts: '2031-05-01T17:00:00Z', ends: '2031-05-01T23:00:00Z', venue: { name: 'Hall', city: 'Phoenix' } })
    await mkDate(e, { starts: '2031-09-01T17:00:00Z' })
    const text = eventCalendar(e, await datesOf(e.id))
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(text).toContain('DTSTART:20310501T170000Z')
    expect(text).toContain('LOCATION:Hall\\, Phoenix')
    expect(text).toContain('\r\n ') // the description was folded
  })
})

describe('fixed choices', () => {
  it('takes start times only in 15-minute steps and countries only as known codes, and keeps the organizer free text', async () => {
    await expect(mkEvent({ name: 'Odd-minute meeting', recurring: true, rule: { ...monthly, from: day(0), time: '19:05' } })).rejects.toThrow()
    const ok = await mkEvent({ name: 'Quarter-past meeting', organizer: 'A society nobody has used before', recurring: true, rule: { ...monthly, from: day(0), time: '19:15' } })
    expect(ok.organizer).toBe('A society nobody has used before')
    const single = await mkEvent({ name: 'Swap meet with a venue' })
    await expect(mkDate(single, { venue: { city: 'Somewhere', country: 'XX' } })).rejects.toThrow()
    const d = await mkDate(single, { venue: { city: 'Somewhere', country: 'US' } })
    expect((d as unknown as { venue: { country: string } }).venue.country).toBe('US')
  })
})


describe('GraphQL', () => {
  it('builds a valid schema: no select value that GraphQL can’t name (start times, timezones)', () => {
    expect(() => configToSchema(payload.config)).not.toThrow()
  })
})
