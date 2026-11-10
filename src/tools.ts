import { APIError, commitTransaction, initTransaction, killTransaction, type Payload, type PayloadRequest, type Where } from 'payload'

import { instantToWall, toICalRule } from './rules.js'
import { asPlugin, eventsOptions, idOf, ruleOf } from './sync.js'
import type { EventDateDoc, EventDoc, Venue } from './types.js'

const bad = (message: string, status = 400): never => {
  throw new APIError(message, status, undefined, true)
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicates

const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'at', 'for', 'annual', 'show', 'expo', 'event', 'meeting', 'day'])
const words = (s: string) =>
  new Set(
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d{4}$/.test(w)),
  )
/** How alike two names are, 0 to 1 (shared words over all words, ignoring years and filler words). */
export function nameSimilarity(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / (x.size + y.size - shared)
}
const host = (url?: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

export type Similar = { id: string; name: string; kind: 'one-time' | 'reusable' | 'recurring'; reasons: ('name' | 'organizer' | 'website' | 'venue')[]; question: string }

/**
 * Existing events that largely overlap a new one: a similar name, the same organizer or website, or the same venue
 * within a day. Each comes with the question to ask. Nothing is merged here.
 */
export async function findSimilar(
  payload: Payload,
  input: { name: string; organizer?: string | null; website?: string | null; venue?: Venue | null; starts?: string | null; id?: string | null; notDuplicateOf?: unknown[] | null },
  opts: { where?: Where; req?: PayloadRequest } = {},
): Promise<Similar[]> {
  const o = eventsOptions(payload)
  const { docs } = await payload.find({ collection: o.events as never, where: opts.where ?? {}, limit: 0, depth: 0, overrideAccess: !opts.req?.user, user: opts.req?.user, pagination: false, draft: true, req: opts.req })
  const dismissed = new Set((input.notDuplicateOf ?? []).map(idOf))
  const venueHits = new Set<string>()
  if (input.starts && input.venue?.postalCode) {
    const t = new Date(input.starts).getTime()
    const near = await payload.find({
      collection: o.dates as never,
      where: { and: [{ 'venue.postalCode': { equals: input.venue.postalCode } }, { starts: { greater_than: new Date(t - 86_400_000).toISOString() } }, { starts: { less_than: new Date(t + 86_400_000).toISOString() } }] },
      limit: 50,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req: opts.req,
    })
    for (const d of near.docs as unknown as EventDateDoc[]) venueHits.add(idOf(d.event))
  }
  const out: Similar[] = []
  for (const e of docs as unknown as EventDoc[]) {
    if (input.id && String(e.id) === String(input.id)) continue
    if (dismissed.has(String(e.id)) || (input.id && (e.notDuplicateOf ?? []).map(idOf).includes(String(input.id)))) continue
    const reasons: Similar['reasons'] = []
    if (nameSimilarity(input.name, e.name) >= 0.5) reasons.push('name')
    if (input.organizer && e.organizer && String(e.organizer).trim().toLowerCase() === input.organizer.trim().toLowerCase()) reasons.push('organizer')
    if (host(input.website) && host(input.website) === host(e.website as string)) reasons.push('website')
    if (venueHits.has(String(e.id))) reasons.push('venue')
    if (!reasons.length) continue
    const kind = e.recurring ? 'recurring' : e.reusable ? 'reusable' : 'one-time'
    out.push({
      id: String(e.id),
      name: e.name,
      kind,
      reasons,
      question: kind === 'one-time' ? `This looks like “${e.name}”. Make “${e.name}” reusable and add this as a new date?` : `This looks like “${e.name}”. Add this date to “${e.name}” instead?`,
    })
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length)
}

// ---------------------------------------------------------------------------------------------------------------
// Arrange (split) and merge

const COPIED = ['type', 'summary', 'website', 'organizer', 'logo', 'logoSource', 'appearsByDefault', 'defaultVenue']

type Plan = { summary: string; newEvents: number; moves: number; refused: string[] }

async function withTransaction<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const started = await initTransaction(req)
  try {
    const out = await fn()
    if (started) await commitTransaction(req)
    return out
  } catch (error) {
    if (started) await killTransaction(req)
    throw error
  }
}

const datesOf = async (req: PayloadRequest, event: string) =>
  (await req.payload.find({ collection: eventsOptions(req.payload).dates as never, where: { event: { equals: event } }, limit: 0, depth: 0, overrideAccess: false, user: req.user, pagination: false, sort: 'starts', req })).docs as unknown as EventDateDoc[]

/**
 * Splits an event's dates into new events. `buckets` lists the dates each new event takes (with an optional name);
 * `allIndividual` makes every date but the first its own one-time event. Plans by default; `apply` does it, in one
 * transaction, as the signed-in person (their access applies). A protected date refuses the whole change.
 */
export async function arrangeDates(req: PayloadRequest, input: { event: string; buckets?: { name?: string; dates: string[] }[]; allIndividual?: boolean; apply?: boolean }) {
  const o = eventsOptions(req.payload)
  const event = (await req.payload.findByID({ collection: o.events as never, id: input.event, depth: 0, overrideAccess: false, user: req.user, draft: true, req })) as unknown as EventDoc
  const all = await datesOf(req, input.event)
  const byId = new Map(all.map((d) => [String(d.id), d]))
  const buckets = input.allIndividual ? all.slice(1).map((d) => ({ name: undefined, dates: [String(d.id)] })) : (input.buckets ?? []).filter((b) => b.dates.length)
  const seen = new Set<string>()
  for (const b of buckets)
    for (const id of b.dates) {
      if (!byId.has(id)) bad('A date in the plan isn’t one of this event’s dates.')
      if (seen.has(id)) bad('A date is in two buckets.')
      seen.add(id)
    }
  const now = Date.now()
  const refused: string[] = []
  for (const id of seen) {
    const d = byId.get(id)!
    if (event.recurring && !input.allIndividual && d.source === 'rule' && new Date(d.starts).getTime() >= now)
      refused.push(`${d.title ?? id}: the rule would make it again. Turn off “Recurring” first, or leave it here.`)
    const why = await o.protectDate?.({ req, date: d, action: 'move' })
    if (why) refused.push(`${d.title ?? id}: ${why}`)
  }
  const plan: Plan = {
    newEvents: buckets.length,
    moves: seen.size,
    refused,
    summary: `${buckets.length} new event${buckets.length === 1 ? '' : 's'}, ${seen.size} date${seen.size === 1 ? '' : 's'} move${seen.size === 1 ? 's' : ''}${input.allIndividual && event.recurring ? '; “Recurring” turns off' : ''}.`,
  }
  if (!input.apply || refused.length) return { ...plan, applied: false }

  await withTransaction(req, () =>
    asPlugin(req, async (r) => {
      const remaining = all.length - seen.size
      for (const b of buckets) {
        const copied = Object.fromEntries([...COPIED, ...o.copyToDates].filter((f) => event[f] !== undefined).map((f) => [f, event[f]]))
        const created = await req.payload.create({
          collection: o.events as never,
          data: { ...copied, name: b.name?.trim() || event.name, reusable: b.dates.length > 1, recurring: false, _status: event._status ?? 'published' } as never,
          overrideAccess: false,
          user: req.user,
          req: r,
          context: { eventsSkipSync: true },
        })
        for (const id of b.dates)
          await req.payload.update({ collection: o.dates as never, id, data: { event: created.id, source: 'manual', edited: false, slot: null, generatedBy: null } as never, overrideAccess: false, user: req.user, req: r })
      }
      // What's left: a single date makes a one-time event again; all-individual also ends the rule.
      const keep: Record<string, unknown> = {}
      if (input.allIndividual) Object.assign(keep, { recurring: false, reusable: remaining > 1 })
      if (Object.keys(keep).length) await req.payload.update({ collection: o.events as never, id: input.event, data: keep as never, overrideAccess: false, user: req.user, req: r, context: { eventsSkipSync: true } })
    }),
  )
  await o.onEvent?.({ type: 'arranged', req, event: input.event, summary: plan.summary })
  return { ...plan, applied: true }
}

/**
 * Merges events into one reusable event: their dates become its dates, their addresses lead to it (`formerSlugs`),
 * and they're removed. Plans by default; `apply` does it in one transaction, as the signed-in person.
 */
export async function mergeEvents(req: PayloadRequest, input: { into: string; from: string[]; apply?: boolean }) {
  const o = eventsOptions(req.payload)
  const from = [...new Set(input.from.map(String))].filter((id) => id !== String(input.into))
  if (!from.length) bad('Choose the events to merge in.')
  const into = (await req.payload.findByID({ collection: o.events as never, id: input.into, depth: 0, overrideAccess: false, user: req.user, draft: true, req })) as unknown as EventDoc
  const sources: EventDoc[] = []
  for (const id of from) sources.push((await req.payload.findByID({ collection: o.events as never, id, depth: 0, overrideAccess: false, user: req.user, draft: true, req })) as unknown as EventDoc)
  const moving: EventDateDoc[] = []
  for (const s of sources) moving.push(...(await datesOf(req, String(s.id))))
  const refused: string[] = []
  for (const s of sources) for (const f of o.copyToDates) if (idOf(s[f]) !== idOf(into[f])) refused.push(`${s.name}: it belongs to a different ${f}.`)
  for (const d of moving) {
    const why = await o.protectDate?.({ req, date: d, action: 'move' })
    if (why) refused.push(`${d.title ?? d.id}: ${why}`)
  }
  const summary = `${sources.length === 1 ? '1 event merges' : `${sources.length} events merge`} into “${into.name}”; ${moving.length === 1 ? '1 date moves' : `${moving.length} dates move`}; ${sources.length === 1 ? 'its address leads' : 'their addresses lead'} to it.`
  if (!input.apply || refused.length) return { summary, moves: moving.length, refused, applied: false }

  await withTransaction(req, () =>
    asPlugin(req, async (r) => {
      // Reusable first, so a one-time event can take the dates.
      await req.payload.update({ collection: o.events as never, id: into.id, data: { reusable: true } as never, overrideAccess: false, user: req.user, req: r, context: { eventsSkipSync: true } })
      for (const d of moving) await req.payload.update({ collection: o.dates as never, id: d.id, data: { event: into.id, source: 'manual', edited: false, slot: null, generatedBy: null } as never, overrideAccess: false, user: req.user, req: r })
      const former = new Set([...(into.formerSlugs ?? []), ...sources.flatMap((s) => [s.slug, ...(s.formerSlugs ?? [])])].filter(Boolean))
      for (const s of sources) await req.payload.delete({ collection: o.events as never, id: s.id, overrideAccess: false, user: req.user, req: r })
      await req.payload.update({ collection: o.events as never, id: into.id, data: { formerSlugs: [...former] } as never, overrideAccess: false, user: req.user, req: r, context: { eventsSkipSync: true } })
    }),
  )
  await o.onEvent?.({ type: 'merged', req, into: String(into.id), from, summary })
  return { summary, moves: moving.length, refused, applied: true }
}

/** An event by its address, following a merge: `{ event, redirect }` where `redirect` is the slug to send people to. */
export async function eventBySlug(payload: Payload, slug: string, opts: { where?: Where; req?: PayloadRequest } = {}) {
  const o = eventsOptions(payload)
  const find = async (field: string) =>
    (
      await payload.find({ collection: o.events as never, where: { and: [opts.where ?? {}, { [field]: { equals: slug } }] }, limit: 1, depth: 1, overrideAccess: !opts.req, user: opts.req?.user, req: opts.req })
    ).docs[0] as unknown as EventDoc | undefined
  const direct = await find('slug')
  if (direct) return { event: direct, redirect: null }
  const moved = await find('formerSlugs')
  return moved ? { event: moved, redirect: moved.slug } : { event: null, redirect: null }
}

// ---------------------------------------------------------------------------------------------------------------
// Near me, and drop-off at checkout

const R_MILES = 3958.8
/** Great-circle distance in miles between two [lng, lat] points. */
export function distanceMiles(a: [number, number], b: [number, number]) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type Nearby = { date: EventDateDoc; miles: number }

/** Scheduled dates between `from` and `to` within `miles` of a point, nearest first. Dates without a location are left out. */
export async function nearbyDates(payload: Payload, q: { lng: number; lat: number; miles: number; from: Date; to: Date; where?: Where; req?: PayloadRequest }): Promise<Nearby[]> {
  const o = eventsOptions(payload)
  const { docs } = await payload.find({
    collection: o.dates as never,
    where: { and: [q.where ?? {}, { status: { equals: 'scheduled' } }, { starts: { greater_than_equal: q.from.toISOString() } }, { starts: { less_than: q.to.toISOString() } }, { location: { exists: true } }] },
    limit: 0,
    depth: 1,
    overrideAccess: !q.req,
    user: q.req?.user,
    pagination: false,
    req: q.req,
  })
  return (docs as unknown as EventDateDoc[])
    .filter((d) => Array.isArray(d.location))
    .map((d) => ({ date: d, miles: distanceMiles([q.lng, q.lat], d.location as [number, number]) }))
    .filter((n) => n.miles <= q.miles)
    .sort((a, b) => a.miles - b.miles || new Date(a.date.starts).getTime() - new Date(b.date.starts).getTime())
}

/**
 * Dates a buyer could hand something in at: an appearance with drop-off on, scheduled, within `miles` of the
 * address, and between `minDays` and `maxDays` from now. Defaults: 150 miles, 2 weeks to 4 months.
 */
export function dropOffDates(payload: Payload, q: { lng: number; lat: number; now?: Date; miles?: number; minDays?: number; maxDays?: number; where?: Where }) {
  const now = q.now ?? new Date()
  const day = 86_400_000
  return nearbyDates(payload, {
    lng: q.lng,
    lat: q.lat,
    miles: q.miles ?? 150,
    from: new Date(now.getTime() + (q.minDays ?? 14) * day),
    to: new Date(now.getTime() + (q.maxDays ?? 120) * day),
    where: { and: [q.where ?? {}, { appearance: { equals: true } }, { dropOff: { equals: true } }] },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar files (RFC 5545)

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
/** Lines longer than 75 octets are folded, as the standard asks. */
function fold(line: string) {
  const bytes = Buffer.from(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + (out.length ? 74 : 75), bytes.length)
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end-- // never split a character
    out.push((out.length ? ' ' : '') + bytes.subarray(start, end).toString())
    start = end
  }
  return out.join('\r\n')
}
const where = (v?: Venue | null) => [v?.name, v?.address, v?.city, v?.region, v?.postalCode, v?.country].filter(Boolean).join(', ')

function vevent(e: EventDoc, d: EventDateDoc, uidDomain: string, url?: string) {
  return [
    'BEGIN:VEVENT',
    `UID:${d.id}@${uidDomain}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(d.starts))}`,
    ...(d.ends ? [`DTEND:${stamp(new Date(d.ends))}`] : []),
    `SUMMARY:${esc(e.name)}`,
    ...(where(d.venue) ? [`LOCATION:${esc(where(d.venue))}`] : []),
    ...(e.summary ? [`DESCRIPTION:${esc(String(e.summary))}`] : []),
    ...(url ? [`URL:${url}`] : []),
    ...(d.status === 'canceled' ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
  ]
}

/**
 * A calendar file for an event. A recurring event is one entry with its rule, so the calendar repeats it, plus
 * dates someone changed (the rule's slot is left out and the changed date added); a reusable event lists its dates.
 */
export function eventCalendar(e: EventDoc, dates: EventDateDoc[], opts: { uidDomain?: string; url?: string; defaultTimezone?: string } = {}) {
  const uidDomain = opts.uidDomain ?? 'payload-plugin-events'
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//payload-plugin-events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  const rule = e.recurring ? ruleOf(e.rule, opts.defaultTimezone ?? 'UTC') : null
  if (rule) {
    const ical = toICalRule(rule)
    const changed = dates.filter((d) => d.source === 'rule' && (d.edited || d.status === 'canceled'))
    // EXDATE in the same form as DTSTART: local time with the TZID.
    const local = (iso: string) => {
      const w = instantToWall(new Date(iso), rule.timezone)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${w.y}${p(w.mo)}${p(w.d)}T${p(w.h)}${p(w.mi)}00`
    }
    const exdates = changed.map((d) => local((d as { slot?: string }).slot ?? d.starts))
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-${e.id}@${uidDomain}`,
      `DTSTAMP:${stamp(new Date())}`,
      ical.dtstart,
      `DURATION:PT${Math.floor(rule.durationMinutes / 60)}H${rule.durationMinutes % 60}M`,
      ical.rrule,
      ...(exdates.length ? [`EXDATE;TZID=${rule.timezone}:${exdates.join(',')}`] : []),
      `SUMMARY:${esc(e.name)}`,
      ...(where(e.defaultVenue) ? [`LOCATION:${esc(where(e.defaultVenue))}`] : []),
      ...(opts.url ? [`URL:${opts.url}`] : []),
      'END:VEVENT',
    )
    for (const d of changed.filter((x) => x.status !== 'canceled')) lines.push(...vevent(e, d, uidDomain, opts.url))
    for (const d of dates.filter((x) => x.source !== 'rule')) lines.push(...vevent(e, d, uidDomain, opts.url))
  } else for (const d of dates) lines.push(...vevent(e, d, uidDomain, opts.url))
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
