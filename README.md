# payload-plugin-events

Events for Payload: events and their dates, with repeat rules in each event's own timezone, near-me search, appearances and drop-off, a duplicate check, merge and split, and calendar files.

**Status:** early, 0.x. The core passes 27 tests against a real Payload 3.92 and MongoDB with made-up events. The admin screens (live rule preview, the duplicate check, Arrange dates, organizer suggestions) were tried in a browser on a local copy of a real site with made-up events, with axe finding nothing in them. It isn't in use on any site yet.

## What it does

- **Events and dates.** An event is what people know by name. Its dates are what they search. An event is one-time (one date), reusable (dates added as announced) or recurring (dates made from a rule).
- **Repeat rules.** You build them from plain choices: every n days, weeks, months or years; which weekdays; a day of the month or the nth weekday; a start time in 15-minute steps; ending never, on a date, or after a number of times. They're worked out in the event's timezone, so a 7 pm meeting stays at 7 pm across daylight saving.
  - Recurring events get dates for the next 12 months. Run `topUpRecurring` nightly to keep that topped up.
  - Changing the rule redoes only future dates that nobody edited. Past, hand-made, edited and protected dates are never touched.
- **Appearances** (optional): a date can say "we'll be there", and only those dates take drop-offs. New dates of reusable and recurring events start ticked unless the event says otherwise.
- **Locations.** Your `geocode` function turns a venue into a map point. `nearbyDates` and `dropOffDates` search by distance, and drop-off defaults to 150 miles and 2 weeks to 4 months ahead.
- **Duplicates.** `findSimilar` matches a similar name, the same organizer or website, or the same venue within a day, and returns the question to ask. "Not a duplicate" is remembered.
- **Merge and split.** `arrangeDates` splits dates into new events. `mergeEvents` folds events into one reusable event; their old addresses lead to it, through `eventBySlug`.
  - Both show a plan first, run in one transaction as the signed-in person, and refuse a protected date.
- **Calendar files.** `GET /api/events/:id/ics` gives a recurring event as one entry with its rule, so calendars repeat it. `GET /api/event-dates/:id/ics` gives one date.

Not built here: the site's own pages, and anything about kits or orders. A site protects dates it depends on through `protectDate`.

## Install

```bash
npm install @captiveorigins/payload-plugin-events
```

Needs Payload 3.80 or later, React 19 and Node 22 or later.

## Use

```ts
import { events } from '@captiveorigins/payload-plugin-events'

events({
  copyToDates: ['tenant'],
  defaultTimezone: 'America/Phoenix',
  appearances: { label: 'We’ll be there' },
  geocode: async ({ venue }) => lookUpPostalCode(venue.postalCode),
  protectDate: async ({ date }) => ((await ordersFor(date.id)) ? 'Kits are booked for this date.' : null),
  access: { write: ({ req }) => isStaff(req.user) },
})
```

- **Who reads what.** Visitors and signed-in people read published events and their dates. Drafts are for those `access.write` lets in, and only where it lets them (a write rule that returns a query limits draft reads the same way). Pass `access.read` to replace this.
- **Copied fields** (`copyToDates`) always come from the event: a value sent with a date is replaced, on create, on every edit and when the date moves to another event. So a date can't claim another site.

## Commands

```bash
npm test          # Vitest, in-memory MongoDB
npm run typecheck
npm run build
```

## License

MIT
