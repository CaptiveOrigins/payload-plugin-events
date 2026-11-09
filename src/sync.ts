import type { Payload, PayloadRequest } from 'payload'

import { occurrences, ruleFingerprint, ruleProblems, type RepeatRule } from './rules.js'
import type { EventDateDoc, EventDoc, ResolvedEventsOptions } from './types.js'

export const eventsOptions = (payload: Payload) => payload.config.custom?.events as ResolvedEventsOptions
export const idOf = (v: unknown) => String(v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v)

/** YYYY-MM-DD from a stored day-only date (Payload keeps those at 12:00 UTC) or a plain day string. */
export const dayOf = (v: unknown) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  if (!v) return ''
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** The stored rule group as a RepeatRule, or null when it isn't complete. */
export function ruleOf(stored: Partial<Record<string, unknown>> | null | undefined, fallbackTz: string): RepeatRule | null {
  if (!stored) return null
  const rule = {
    every: Number(stored.every ?? 1),
    unit: stored.unit as RepeatRule['unit'],
    weekdays: (stored.weekdays as RepeatRule['weekdays']) ?? null,
    monthly: (stored.monthly as RepeatRule['monthly']) ?? null,
    monthDay: stored.monthDay == null ? null : Number(stored.monthDay),
    setPos: stored.setPos == null || stored.setPos === '' ? null : (Number(stored.setPos) as RepeatRule['setPos']),
    weekday: (stored.weekday as RepeatRule['weekday']) ?? null,
    from: dayOf(stored.from),
    time: String(stored.time ?? '').trim(),
    durationMinutes: Number(stored.durationMinutes ?? 0),
    ends: (stored.ends as RepeatRule['ends']) ?? 'never',
    until: stored.until ? dayOf(stored.until) : null,
    count: stored.count == null ? null : Number(stored.count),
    timezone: String(stored.timezone ?? fallbackTz),
  } satisfies RepeatRule
  return ruleProblems(rule).length ? null : rule
}

/** Runs `fn` marked as the plugin's own work (no "edited" marks, no protection prompts), then restores the mark. */
export async function asPlugin<T>(req: PayloadRequest | undefined, fn: (req: PayloadRequest | undefined) => Promise<T>): Promise<T> {
  if (!req) return fn(undefined)
  const before = req.context?.eventsInternal
  req.context = { ...(req.context ?? {}), eventsInternal: true }
  try {
    return await fn(req)
  } finally {
    req.context.eventsInternal = before
  }
}

async function protectedReason(payload: Payload, date: EventDateDoc, action: 'delete' | 'move', req?: PayloadRequest) {
  const { protectDate } = eventsOptions(payload)
  if (!protectDate) return null
  return protectDate({ req: req ?? ({ payload, context: {} } as unknown as PayloadRequest), date, action })
}

/**
 * Makes a recurring event's dates match its rule, up to the horizon. Future dates the rule made and nobody edited
 * are redone when the rule changes; past dates, hand-made dates, edited dates and protected dates are never
 * touched. An event that stops recurring (or is unpublished) loses its future generated dates the same way.
 */
export async function syncDates(payload: Payload, event: EventDoc, opts: { now?: Date; req?: PayloadRequest } = {}) {
  const o = eventsOptions(payload)
  const now = opts.now ?? new Date()
  const rule = event.recurring && event._status !== 'draft' ? ruleOf(event.rule, o.defaultTimezone) : null
  const fp = rule ? ruleFingerprint(rule) : null
  const { docs } = await payload.find({
    collection: o.dates as never,
    where: { and: [{ event: { equals: event.id } }, { source: { equals: 'rule' } }, { starts: { greater_than_equal: now.toISOString() } }] },
    limit: 0,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req: opts.req,
  })
  const future = docs as unknown as (EventDateDoc & { slot?: string; generatedBy?: string })[]
  let removed = 0
  let created = 0
  await asPlugin(opts.req, async (req) => {
    for (const d of future) {
      if (d.edited || (fp && d.generatedBy === fp)) continue
      if (await protectedReason(payload, d, 'delete', req)) continue
      await payload.delete({ collection: o.dates as never, id: d.id, overrideAccess: true, req })
      removed++
    }
    if (!rule) return
    // Slots already taken, by a generated date of this rule, edited or not (an edited date keeps its original slot).
    const taken = new Set(future.filter((d) => d.generatedBy === fp || d.edited).map((d) => d.slot))
    const horizon = new Date(now)
    horizon.setUTCMonth(horizon.getUTCMonth() + o.horizonMonths)
    for (const occ of occurrences(rule, { after: now, before: horizon })) {
      const slot = occ.starts.toISOString()
      if (taken.has(slot)) continue
      const copied = Object.fromEntries(o.copyToDates.map((f) => [f, (event as Record<string, unknown>)[f]]).filter(([, v]) => v !== undefined))
      await payload.create({
        collection: o.dates as never,
        data: { ...copied, event: event.id, starts: slot, ends: occ.ends.toISOString(), timezone: rule.timezone, source: 'rule', slot, generatedBy: fp, status: 'scheduled' } as never,
        overrideAccess: true,
        req,
      })
      created++
    }
  })
  if (created || removed) await o.onEvent?.({ type: 'dates-generated', payload, event: String(event.id), created, removed })
  return { created, removed }
}

/** For a nightly job: tops up every published recurring event to the horizon. */
export async function topUpRecurring(payload: Payload, opts: { now?: Date } = {}) {
  const o = eventsOptions(payload)
  const { docs } = await payload.find({ collection: o.events as never, where: { and: [{ recurring: { equals: true } }, { _status: { equals: 'published' } }] }, limit: 0, depth: 0, overrideAccess: true, pagination: false })
  let created = 0
  for (const e of docs as unknown as EventDoc[]) created += (await syncDates(payload, e, opts)).created
  return { events: docs.length, created }
}
