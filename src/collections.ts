import { APIError, type Access, type CollectionConfig, type Field, type PayloadRequest, type Where } from 'payload'

import { adminUsersOnly, strictWrite, writeScope } from './access.js'
import { timezoneField, venueFields, ruleFields } from './fields.js'
import { describeRule, nextOccurrences, ruleFingerprint, ruleProblems } from './rules.js'
import { asPlugin, dayOf, eventsOptions, idOf, ruleOf, syncDates } from './sync.js'
import type { EventDateDoc, EventDoc, ResolvedEventsOptions, Venue } from './types.js'

const internal = (req: PayloadRequest) => req.context?.eventsInternal === true
const bad = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}
const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'event'

const sameVenue = (a?: Venue | null, b?: Venue | null) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
const hasVenue = (v?: Venue | null) => Boolean(v && Object.values(v).some((x) => typeof x === 'string' && x.trim()))

export function eventCollections(o: ResolvedEventsOptions): CollectionConfig[] {
  // Only an exact `true` or a real query from the rule counts; anything else, an error included, is a no (2026-11-11).
  const rule = o.access?.write ?? adminUsersOnly
  const write = strictWrite(rule)
  const appearancesOn = (req: PayloadRequest, data?: unknown) => Boolean(o.appearances && (o.appearances.enabled?.({ req, data }) ?? true))
  const appearanceLabel = (o.appearances && o.appearances.label) || 'We’ll be there'

  // Drafts only for people who may change them (where they may); everyone else, signed in or not, reads published.
  const readable =
    (published: Where): Access =>
    async (args) => {
      const w = await writeScope(rule, args)
      if (w === true) return true
      return w ? { or: [w, published] } : published
    }
  const readEvents: Access = o.access?.read ?? readable({ _status: { equals: 'published' } })
  const readDates: Access = o.access?.read ?? readable({ 'event._status': { equals: 'published' } } as Where)

  const events: CollectionConfig = {
    slug: o.events,
    labels: { singular: 'Event', plural: 'Events' },
    admin: { useAsTitle: 'name', group: 'Events', defaultColumns: ['name', 'type', 'reusable', 'recurring', '_status'] },
    versions: { drafts: true },
    access: { read: readEvents, create: write, update: write, delete: write },
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'duplicateCheck', type: 'ui', admin: { components: { Field: '@captiveorigins/payload-plugin-events/client#DuplicateCheck' }, condition: (d: Record<string, unknown>) => !d?.id } },
      { name: 'slug', type: 'text', index: true, admin: { position: 'sidebar', description: 'Made from the name if left empty.' } },
      { name: 'type', type: 'select', required: true, defaultValue: 'other', options: o.types, admin: { position: 'sidebar' } },
      { name: 'summary', type: 'textarea' },
      {
        type: 'row',
        fields: [
          { name: 'website', type: 'text', validate: (v: unknown) => !v || /^https?:\/\/\S+\.\S+/.test(String(v)) || 'Start the address with https://' },
          { name: 'organizer', type: 'text', admin: { components: { Field: '@captiveorigins/payload-plugin-events/client#OrganizerField' } } },
        ],
      },
      ...(o.media
        ? ([
            { name: 'logo', type: 'upload', relationTo: o.media as never },
            { name: 'logoSource', type: 'text', label: 'Where the logo came from', admin: { description: 'Kept so a logo can be found and removed at once if its owner asks.', condition: (d: Record<string, unknown>) => Boolean(d?.logo) } },
          ] as Field[])
        : []),
      {
        type: 'row',
        fields: [
          { name: 'reusable', type: 'checkbox', label: 'Reusable: held more than once', admin: { description: 'Dates are added as they’re announced.' } },
          { name: 'recurring', type: 'checkbox', label: 'Recurring: repeats on a rule', admin: { description: 'Dates are made from the rule for the next ' + o.horizonMonths + ' months.' } },
        ],
      },
      { name: 'rule', type: 'group', label: 'Repeats', admin: { condition: (d: Record<string, unknown>) => Boolean(d?.recurring) }, fields: ruleFields(o.defaultTimezone) },
      { name: 'rulePreview', type: 'ui', admin: { components: { Field: '@captiveorigins/payload-plugin-events/client#RulePreview' }, condition: (d: Record<string, unknown>) => Boolean(d?.recurring) } },
      { name: 'ruleSummary', type: 'textarea', label: 'In words, with the next dates', admin: { readOnly: true, condition: (d: Record<string, unknown>) => Boolean(d?.recurring) } },
      { name: 'ruleFingerprint', type: 'text', admin: { hidden: true } },
      { name: 'defaultVenue', type: 'group', label: 'Usual venue', admin: { description: 'New dates start with this venue.', condition: (d: Record<string, unknown>) => Boolean(d?.reusable || d?.recurring) }, fields: venueFields },
      ...(o.appearances
        ? ([
            {
              name: 'appearsByDefault',
              type: 'checkbox',
              defaultValue: true,
              label: `New dates start with “${appearanceLabel}” ticked`,
              admin: { condition: (d: Record<string, unknown>) => Boolean(d?.reusable || d?.recurring) },
            },
          ] as Field[])
        : []),
      { name: 'dates', type: 'join', collection: o.dates as never, on: 'event', defaultSort: 'starts', defaultLimit: 20, admin: { description: 'Add a date here and it’s linked to this event.', condition: (d: Record<string, unknown>) => Boolean(d?.id) } },
      { name: 'arrange', type: 'ui', label: 'Arrange dates', admin: { components: { Field: '@captiveorigins/payload-plugin-events/client#ArrangeDates' }, condition: (d: Record<string, unknown>) => Boolean(d?.id) } },
      { name: 'notDuplicateOf', type: 'relationship', relationTo: o.events as never, hasMany: true, admin: { readOnly: true, position: 'sidebar', description: 'Events someone said this is not a copy of.' } },
      { name: 'formerSlugs', type: 'text', hasMany: true, admin: { readOnly: true, position: 'sidebar', description: 'Old addresses that lead here after a merge.' } },
    ],
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, req }) => {
          if (data.recurring) data.reusable = true
          if (!data.slug && data.name) data.slug = await freeSlug(req, o, slugify(data.name), data, originalDoc?.id)
          else if (data.slug && data.slug !== originalDoc?.slug) data.slug = await freeSlug(req, o, slugify(data.slug), data, originalDoc?.id)
          const merged = { ...originalDoc, ...data }
          if (merged.recurring) {
            const rule = ruleOf(merged.rule, o.defaultTimezone)
            if (!rule) {
              // Drafts may be half-built; publishing needs a whole rule.
              if (merged._status === 'published') bad(`The repeat rule isn’t finished: ${ruleProblems({ ...merged.rule, from: dayOf(merged.rule?.from), until: merged.rule?.until ? dayOf(merged.rule.until) : null, setPos: merged.rule?.setPos ? Number(merged.rule.setPos) : null }).join(' ')}`)
              data.ruleSummary = null
              data.ruleFingerprint = null
            } else {
              const next = nextOccurrences(rule, 6)
              const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: rule.timezone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
              data.ruleSummary = `${describeRule(rule)} (${rule.timezone}).${next.length ? `\nNext: ${next.map((n) => fmt.format(n.starts)).join(' · ')}` : '\nNo more dates.'}`
              data.ruleFingerprint = ruleFingerprint(rule)
            }
          }
          return data
        },
      ],
      afterChange: [
        async ({ doc, previousDoc, req }) => {
          // "Not a duplicate" holds both ways.
          const before = new Set((previousDoc?.notDuplicateOf ?? []).map(idOf))
          for (const other of (doc.notDuplicateOf ?? []).map(idOf).filter((x: string) => !before.has(x))) {
            const e = (await req.payload.findByID({ collection: o.events as never, id: other, depth: 0, overrideAccess: true, draft: true, disableErrors: true, req })) as EventDoc | null
            const theirs = (e?.notDuplicateOf ?? []).map(idOf)
            if (e && !theirs.includes(String(doc.id)))
              await req.payload.update({ collection: o.events as never, id: other, data: { notDuplicateOf: [...theirs, String(doc.id)] } as never, overrideAccess: true, req, context: { eventsSkipSync: true } })
          }
          if (req.context?.eventsSkipSync) return doc
          const changed = doc.ruleFingerprint !== previousDoc?.ruleFingerprint || doc.recurring !== previousDoc?.recurring || doc._status !== previousDoc?._status
          if (changed && (doc.recurring || previousDoc?.recurring)) await syncDates(req.payload, doc as EventDoc, { req })
          return doc
        },
      ],
      beforeDelete: [
        async ({ id, req }) => {
          const { docs } = await req.payload.find({ collection: o.dates as never, where: { event: { equals: id } }, limit: 0, depth: 0, overrideAccess: true, pagination: false, req })
          for (const d of docs as unknown as EventDateDoc[]) {
            const why = await o.protectDate?.({ req, date: d, action: 'delete' })
            if (why) bad(`This event can’t be deleted: ${why}`)
          }
        },
      ],
      afterDelete: [
        async ({ id, req }) => {
          await asPlugin(req, (r) => req.payload.delete({ collection: o.dates as never, where: { event: { equals: id } }, overrideAccess: true, req: r }))
        },
      ],
    },
  }

  const dates: CollectionConfig = {
    slug: o.dates,
    labels: { singular: 'Event date', plural: 'Event dates' },
    admin: { useAsTitle: 'title', group: 'Events', defaultColumns: ['title', 'starts', 'status', ...(o.appearances ? ['appearance', 'dropOff'] : [])] },
    access: { read: readDates, create: write, update: write, delete: write },
    fields: [
      { name: 'event', type: 'relationship', relationTo: o.events as never, required: true, index: true },
      { name: 'title', type: 'text', admin: { readOnly: true, description: 'Made from the event’s name and the date.' } },
      {
        type: 'row',
        fields: [
          { name: 'starts', type: 'date', required: true, index: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
          { name: 'ends', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
        ],
      },
      timezoneField('timezone', o.defaultTimezone),
      {
        name: 'status',
        type: 'select',
        defaultValue: 'scheduled',
        options: [
          { label: 'Scheduled', value: 'scheduled' },
          { label: 'Canceled', value: 'canceled' },
          { label: 'Postponed', value: 'postponed' },
        ],
        admin: { position: 'sidebar' },
      },
      ...(o.appearances
        ? ([
            { name: 'appearance', type: 'checkbox', label: appearanceLabel, admin: { position: 'sidebar' } },
            {
              name: 'dropOff',
              type: 'checkbox',
              label: 'Drop-off here',
              admin: { position: 'sidebar', description: `Only with “${appearanceLabel}”: someone has to be there.`, condition: (d: Record<string, unknown>) => Boolean(d?.appearance) },
            },
          ] as Field[])
        : []),
      { name: 'venue', type: 'group', fields: venueFields },
      { name: 'location', type: 'point', admin: { description: 'Found from the postal code when the venue changes. Longitude, latitude.' } },
      {
        type: 'row',
        fields: [
          { name: 'capacity', type: 'number', min: 0 },
          { name: 'full', type: 'checkbox', label: 'Full' },
        ],
      },
      { name: 'notes', type: 'textarea' },
      {
        name: 'source',
        type: 'select',
        defaultValue: 'manual',
        options: [
          { label: 'Entered by hand', value: 'manual' },
          { label: 'Made from the repeat rule', value: 'rule' },
        ],
        admin: { readOnly: true, position: 'sidebar' },
      },
      { name: 'edited', type: 'checkbox', admin: { readOnly: true, position: 'sidebar', description: 'A made date someone changed: the rule leaves it alone.', condition: (d: Record<string, unknown>) => d?.source === 'rule' } },
      { name: 'slot', type: 'text', admin: { hidden: true } },
      { name: 'generatedBy', type: 'text', admin: { hidden: true } },
    ],
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, operation, req }) => {
          const merged = { ...originalDoc, ...data } as EventDateDoc
          const eventId = idOf(merged.event)
          const event = (await req.payload.findByID({ collection: o.events as never, id: eventId, depth: 0, overrideAccess: true, draft: true, disableErrors: true, req })) as EventDoc | null
          if (!event) bad('Choose the event this date belongs to.')
          const own = !internal(req)

          if (operation === 'update' && originalDoc && idOf(originalDoc.event) !== eventId && own) {
            const why = await o.protectDate?.({ req, date: originalDoc as EventDateDoc, action: 'move' })
            if (why) bad(`This date can’t move to another event: ${why}`)
          }
          // Copied fields (the site, say) always come from the event, never from the request: a date can't claim
          // another site, on create, on an edit or by moving to another event.
          for (const f of o.copyToDates) if ((event as Record<string, unknown>)[f] !== undefined) data[f] = (event as Record<string, unknown>)[f]
          if (operation === 'create' || idOf(originalDoc?.event) !== eventId) {
            if (!event!.reusable && !event!.recurring) {
              const others = await req.payload.count({ collection: o.dates as never, where: { and: [{ event: { equals: eventId } }, ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : [])] }, overrideAccess: true, req })
              if (others.totalDocs > 0) bad('A one-time event has one date. Tick “Reusable” on the event to add more.')
            }
          }
          if (operation === 'create') {
            if (!data.timezone) data.timezone = event!.rule?.timezone ?? o.defaultTimezone
            if (!hasVenue(data.venue) && hasVenue(event!.defaultVenue)) data.venue = event!.defaultVenue
            if (o.appearances && data.appearance == null && (event!.reusable || event!.recurring) && appearancesOn(req, data)) data.appearance = event!.appearsByDefault !== false
          }
          if (merged.ends && new Date(merged.ends) < new Date(merged.starts)) bad('The end is before the start.')
          if (o.appearances) {
            const appearance = data.appearance ?? originalDoc?.appearance
            if (!appearancesOn(req, data)) {
              if (operation === 'create') data.appearance = false
              data.dropOff = false
            } else if ((data.dropOff ?? originalDoc?.dropOff) && !appearance) {
              // Newly ticking drop-off without anyone there is refused; turning the appearance off just ends drop-off.
              const newlyTicked = data.dropOff === true && originalDoc?.dropOff !== true
              if (own && newlyTicked) bad('Drop-off needs someone there: tick “' + appearanceLabel + '” first.')
              data.dropOff = false
            }
          }
          if (own && operation === 'update' && originalDoc?.source === 'rule') data.edited = true
          // A new or changed venue gets its point looked up, unless the person typed a point themselves.
          const venue = (data.venue ?? originalDoc?.venue) as Venue | undefined
          const venueChanged = operation === 'create' || !sameVenue(venue, originalDoc?.venue)
          const pointTyped = Array.isArray(data.location) && JSON.stringify(data.location) !== JSON.stringify(originalDoc?.location ?? null)
          if (o.geocode && venueChanged && hasVenue(venue) && !pointTyped) {
            const p = await o.geocode({ venue: venue!, req })
            data.location = p ? [p.lng, p.lat] : null
          }
          const tz = (data.timezone ?? originalDoc?.timezone ?? o.defaultTimezone) as string
          data.title = `${event!.name} · ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(merged.starts))}`
          return data
        },
      ],
      beforeDelete: [
        async ({ id, req }) => {
          if (internal(req) || !o.protectDate) return
          const date = (await req.payload.findByID({ collection: o.dates as never, id, depth: 0, overrideAccess: true, req })) as unknown as EventDateDoc
          const why = await o.protectDate({ req, date, action: 'delete' })
          if (why) bad(`This date can’t be deleted: ${why}`)
        },
      ],
    },
  }

  return [events, dates]
}

/** A slug nobody else in the same scope (the `copyToDates` fields, e.g. the site) has, as a slug or a former one. */
async function freeSlug(req: PayloadRequest, o: ResolvedEventsOptions, wanted: string, data: Record<string, unknown>, selfId?: unknown) {
  const scope = o.copyToDates.filter((f) => data[f] !== undefined).map((f) => ({ [f]: { equals: idOf(data[f]) } }))
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? wanted : `${wanted}-${n}`
    const taken = await req.payload.count({
      collection: o.events as never,
      where: { and: [...scope, { or: [{ slug: { equals: slug } }, { formerSlugs: { equals: slug } }] }, ...(selfId ? [{ id: { not_equals: selfId } }] : [])] } as never,
      overrideAccess: true,
      req,
    })
    if (!taken.totalDocs) return slug
  }
  return `${wanted}-${Date.now()}`
}

export { eventsOptions }
