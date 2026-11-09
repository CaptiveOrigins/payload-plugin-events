import { addDataAndFileToRequest, APIError, type Config, type Endpoint, type PayloadRequest, type Plugin } from 'payload'

import { eventCollections } from './collections.js'
import { describeRule, nextOccurrences, ruleProblems } from './rules.js'
import { dayOf, eventsOptions, ruleOf } from './sync.js'
import { arrangeDates, eventCalendar, findSimilar, mergeEvents } from './tools.js'
import { DEFAULT_TYPES, type EventDateDoc, type EventDoc, type EventsOptions, type ResolvedEventsOptions } from './types.js'

export { describeRule, nextOccurrences, occurrences, ruleProblems, toICalRule, wallToInstant, type RepeatRule } from './rules.js'
export { syncDates, topUpRecurring } from './sync.js'
export { arrangeDates, distanceMiles, dropOffDates, eventBySlug, eventCalendar, findSimilar, mergeEvents, nameSimilarity, nearbyDates, type Nearby, type Similar } from './tools.js'
export { DEFAULT_TYPES, type EventDateDoc, type EventDoc, type EventsAudit, type EventsOptions, type EventType, type Venue } from './types.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const ics = (body: string, name: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '-')}.ics"` } })

async function mayWrite(req: PayloadRequest) {
  const o = eventsOptions(req.payload)
  const rule = o.access?.write
  const ok = rule ? await rule({ req } as never) : Boolean(req.user)
  if (!ok) throw new APIError('You can’t change events.', req.user ? 403 : 401, undefined, true)
}
const body = async (req: PayloadRequest) => {
  await addDataAndFileToRequest(req)
  return (req.data ?? {}) as Record<string, unknown>
}

function endpoints(o: ResolvedEventsOptions): { events: Endpoint[]; dates: Endpoint[] } {
  const uid = (req: PayloadRequest) => new URL(req.url ?? 'http://localhost').hostname
  return {
    events: [
      {
        // A calendar file for the whole event (read access applies, so drafts stay hidden).
        path: '/:id/ics',
        method: 'get',
        handler: async (req) => {
          const id = String(req.routeParams?.id ?? '')
          const e = (await req.payload.findByID({ collection: o.events as never, id, depth: 0, overrideAccess: false, user: req.user, disableErrors: true, req })) as EventDoc | null
          if (!e) return json({ message: 'Not found.' }, 404)
          const { docs } = await req.payload.find({ collection: o.dates as never, where: { event: { equals: id } }, limit: 0, depth: 0, overrideAccess: false, user: req.user, pagination: false, sort: 'starts', req })
          return ics(eventCalendar(e, docs as unknown as EventDateDoc[], { uidDomain: uid(req), defaultTimezone: o.defaultTimezone }), e.slug || e.name)
        },
      },
      {
        // The admin's live preview of a rule while it's being built.
        path: '/preview-rule',
        method: 'post',
        handler: async (req) => {
          await mayWrite(req)
          const stored = (await body(req)).rule as Record<string, unknown> | undefined
          const rule = ruleOf(stored, o.defaultTimezone)
          if (!rule)
            return json({ problems: ruleProblems({ ...(stored ?? {}), from: dayOf(stored?.from), until: stored?.until ? dayOf(stored.until) : null, setPos: stored?.setPos ? (Number(stored.setPos) as never) : null } as never) }, 200)
          return json({ problems: [], summary: describeRule(rule), next: nextOccurrences(rule, 6).map((n) => n.starts.toISOString()), timezone: rule.timezone })
        },
      },
      {
        path: '/similar',
        method: 'post',
        handler: async (req) => {
          await mayWrite(req)
          const b = await body(req)
          if (typeof b.name !== 'string' || !b.name.trim()) return json({ matches: [] })
          return json({ matches: await findSimilar(req.payload, b as never, { req }) })
        },
      },
      {
        // "No, it's a different event": remembered on both, so neither asks again.
        path: '/:id/not-duplicate',
        method: 'post',
        handler: async (req) => {
          await mayWrite(req)
          const id = String(req.routeParams?.id ?? '')
          const other = String((await body(req)).of ?? '')
          for (const [a, b] of [
            [id, other],
            [other, id],
          ] as const) {
            const e = (await req.payload.findByID({ collection: o.events as never, id: a, depth: 0, overrideAccess: false, user: req.user, draft: true, req })) as EventDoc
            const list = [...new Set([...(e.notDuplicateOf ?? []).map((x) => String(x && typeof x === 'object' && 'id' in x ? (x as { id: unknown }).id : x)), b])]
            await req.payload.update({ collection: o.events as never, id: a, data: { notDuplicateOf: list } as never, overrideAccess: false, user: req.user, req, context: { eventsSkipSync: true } })
          }
          return json({ ok: true })
        },
      },
      {
        path: '/:id/arrange',
        method: 'post',
        handler: async (req) => {
          await mayWrite(req)
          const b = await body(req)
          return json(await arrangeDates(req, { event: String(req.routeParams?.id ?? ''), buckets: b.buckets as never, allIndividual: b.allIndividual === true, apply: b.apply === true }))
        },
      },
      {
        path: '/merge',
        method: 'post',
        handler: async (req) => {
          await mayWrite(req)
          const b = await body(req)
          return json(await mergeEvents(req, { into: String(b.into ?? ''), from: (b.from as string[]) ?? [], apply: b.apply === true }))
        },
      },
    ],
    dates: [
      {
        path: '/:id/ics',
        method: 'get',
        handler: async (req) => {
          const d = (await req.payload.findByID({ collection: o.dates as never, id: String(req.routeParams?.id ?? ''), depth: 1, overrideAccess: false, user: req.user, disableErrors: true, req })) as (EventDateDoc & { event: EventDoc }) | null
          if (!d || typeof d.event !== 'object') return json({ message: 'Not found.' }, 404)
          return ics(eventCalendar({ ...d.event, recurring: false }, [d], { uidDomain: uid(req) }), `${d.event.slug || d.event.name}-${d.starts.slice(0, 10)}`)
        },
      },
    ],
  }
}

/**
 * Events for Payload: events (what people know by name) and their dates (what they search), with repeat rules in
 * the event's own timezone, appearances and drop-off, a duplicate check, merge and split, near-me search and
 * calendar files.
 */
export const events =
  (options: EventsOptions = {}): Plugin =>
  (config: Config): Config => {
    const o: ResolvedEventsOptions = {
      events: 'events',
      dates: 'event-dates',
      media: 'media',
      types: DEFAULT_TYPES,
      appearances: false,
      copyToDates: [],
      horizonMonths: 12,
      defaultTimezone: 'UTC',
      ...options,
    }
    for (const slug of [o.events, o.dates]) if ((config.collections ?? []).some((c) => c.slug === slug)) throw new Error(`events: a collection "${slug}" already exists.`)
    if (o.media && !(config.collections ?? []).some((c) => c.slug === o.media)) throw new Error(`events: no upload collection "${o.media}" for logos (set media: false to go without).`)
    const [ev, dt] = eventCollections(o)
    const eps = endpoints(o)
    return {
      ...config,
      collections: [...(config.collections ?? []), { ...ev!, endpoints: eps.events }, { ...dt!, endpoints: eps.dates }],
      custom: { ...config.custom, events: o },
    }
  }
