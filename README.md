# payload-plugin-events

Events for Payload: events and their dates, with repeat rules in each event's own timezone, near-me search, appearances and drop-off, a duplicate check, merge and split, and calendar files.

**Status:** early, 0.x. The core passes 36 tests against a real Payload 3.92 and MongoDB with made-up events. The admin screens (live rule preview, the duplicate check, Arrange dates, organizer suggestions) were tried in a browser on a local copy of a real site with made-up events, with axe finding nothing in them. It isn't in use on any site yet.

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

## On its own, and with others

**On its own:** Events needs only Payload. Give it a `geocode` function if you want near-me and drop-off searches, and a `protectDate` check if anything on your site depends on a date.

**Works with:**
- **Sample Kits:** your site maps Events' `dropOffDates` onto Sample Kits' `adapters.events.dropOffChoices`, so buyers can hand kits in at an event, and `protectDate` can protect a date that has kits booked, as in [Use](#use). Events knows nothing about kits.

It doesn't need any other plugin, and nothing here is specific to one.

**Family:** Events has no family on purpose: it's meant to work with any plugin. The families are a working draft, and Fulfillment is due to be split.

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
- **Who writes.** See [Access](#access).
- **Copied fields** (`copyToDates`) always come from the event: a value sent with a date is replaced, on create, on every edit and when the date moves to another event. So a date can't claim another site.

## Access

`access.write` is a Payload `Access` function. It decides who creates, edits and deletes events, who reads drafts, and who uses the admin endpoints (rule preview, duplicate check, "not a duplicate", Arrange dates, merge). It can answer three ways:

| Answer | Means |
|---|---|
| `true` | Any event |
| A query, such as `{ tenant: { in: [...] } }` | Only events inside it. The endpoints load every event a request names through the query, and answer 404 if one is outside it, so a curator of one site can't arrange, merge or mark events of another, and a merge that mixes sites is refused whole |
| Anything else | No. That includes `false`, `1`, `'yes'`, an empty `{}` (it would match every event), an array, and an error thrown or rejected. An error is a 403 (401 if nobody is signed in), never a 500 |

With no `access.write`, only users of your admin collection (`admin.user` in your Payload config, usually `users`) can write. Accounts from any other auth collection, such as site members, are refused.

**Changed 2026-11-11 (unreleased):** the default used to let any signed-in account write, members of other auth collections included, and the endpoints took any truthy answer from `access.write` as a yes. Sites relying on the old default must pass the option, for example `access: { write: ({ req }) => Boolean(req.user) }`.

## Commands

```bash
npm test          # Vitest, in-memory MongoDB
npm run typecheck
npm run build
```

## License

MIT
