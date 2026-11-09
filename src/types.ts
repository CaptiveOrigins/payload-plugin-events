import type { Access, Payload, PayloadRequest } from 'payload'

import type { RepeatRule } from './rules.js'

export type EventType = { value: string; label: string }

export const DEFAULT_TYPES: EventType[] = [
  { value: 'conference', label: 'Conference' },
  { value: 'show', label: 'Show or expo' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'adoption-day', label: 'Adoption day' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'field-trip', label: 'Field trip' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
]

export type Venue = { name?: string | null; address?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string | null }

export type EventsOptions = {
  /** Slugs. Default `events` and `event-dates`. */
  events?: string
  dates?: string
  /** Upload collection for logos. Default `media`; false for no logos. */
  media?: string | false
  /** Event types. Default: conference, show or expo, meeting, adoption day, workshop, field trip, online, other. */
  types?: EventType[]
  /**
   * Appearances: each date can say "we'll be there", and only those dates can take drop-offs. Off by default.
   * `enabled` decides per request (e.g. a per-site setting); it hides the fields where it's off.
   */
  appearances?: false | { label?: string; enabled?: (args: { req: PayloadRequest; data?: unknown }) => boolean }
  /** Finds a map point for a venue (the site's own gazetteer, say). Without it, dates have no location. */
  geocode?: (args: { venue: Venue; req: PayloadRequest }) => Promise<{ lng: number; lat: number } | null>
  /** Fields copied from an event onto its dates when they're made, e.g. `['tenant']` on a multi-site install. */
  copyToDates?: string[]
  /** How far ahead recurring dates are made, in months. Default 12. */
  horizonMonths?: number
  /** Default timezone for new events. Default `UTC`. */
  defaultTimezone?: string
  /** Who reads and who writes. Default: anyone reads published events and their dates; signed-in users write. */
  access?: { read?: Access; write?: Access }
  /**
   * Called before a date is deleted or moved away from its event by a person or the tools here. Return a reason to
   * refuse (e.g. "Kits are booked for this date"), or null.
   */
  protectDate?: (args: { req: PayloadRequest; date: EventDateDoc; action: 'delete' | 'move' }) => Promise<string | null> | string | null
  /** Called after anything the audit log should know about. */
  onEvent?: (event: EventsAudit) => void | Promise<void>
}

export type EventsAudit =
  | { type: 'dates-generated'; payload: Payload; event: string; created: number; removed: number }
  | { type: 'arranged'; req: PayloadRequest; event: string; summary: string }
  | { type: 'merged'; req: PayloadRequest; into: string; from: string[]; summary: string }

export type EventDoc = {
  id: string
  name: string
  slug: string
  reusable?: boolean | null
  recurring?: boolean | null
  rule?: Partial<RepeatRule> | null
  ruleFingerprint?: string | null
  appearsByDefault?: boolean | null
  defaultVenue?: Venue | null
  formerSlugs?: string[] | null
  notDuplicateOf?: unknown[] | null
  _status?: 'draft' | 'published'
  [key: string]: unknown
}

export type EventDateDoc = {
  id: string
  event: unknown
  starts: string
  ends?: string | null
  timezone?: string | null
  status?: 'scheduled' | 'cancelled' | 'postponed'
  source?: 'manual' | 'rule'
  edited?: boolean | null
  appearance?: boolean | null
  dropOff?: boolean | null
  venue?: Venue | null
  location?: [number, number] | null
  [key: string]: unknown
}

export type ResolvedEventsOptions = Required<Pick<EventsOptions, 'events' | 'dates' | 'media' | 'types' | 'appearances' | 'copyToDates' | 'horizonMonths' | 'defaultTimezone'>> &
  Omit<EventsOptions, 'events' | 'dates' | 'media' | 'types' | 'appearances' | 'copyToDates' | 'horizonMonths' | 'defaultTimezone'>
