# Test audit

Newest first.

## 2026-11-11: the default timezone is always valid

- **The change.** `src/fields.ts`: the timezone list starts with `UTC`, which `Intl.supportedValuesOf('timeZone')` leaves out. `src/index.ts`: a `defaultTimezone` outside the list is refused at start-up.
- **Tests.** `test/default-timezone.test.ts`: with no `defaultTimezone`, a one-time event, its date, and a repeating event with its made dates all save in `UTC`; `Mars/Olympus_Mons` is refused at start-up with the message, `Europe/London` isn't. `test/access-default.test.ts` no longer needs its timezone workaround comment.
- **Mutation checks.** 4, each a Python string replace restored byte for byte (SHA-256 checked); all 4 fail the new tests: `UTC` left out of the list (start-up refusal), the start-up check removed, both together (the save fails validation), and the default changed to `Etc/UTC`.
- **Closes** the note for the lead in the entry below.

## 2026-11-11: write access fails closed, and a query scopes the endpoints

Suite: 27 tests before, 36 after (`npx vitest run`, real Payload 3.92, in-memory MongoDB, made-up events and users; no site).

- **The change.** `src/access.ts`: `adminUsersOnly` (the default write rule: the user's collection equals `admin.user`), `asWhere` (a plain object with at least one key), `writeScope` (exactly `true`, a real query, or nothing; a throw is nothing) and `strictWrite` (what Payload gets as create, update and delete access). Draft reads use `writeScope` too. The endpoints' `mayWrite` takes the event ids a request names; with a query, it loads them through it (`{ and: [{ id: { in } }, query] }`) and answers 404 unless every one is inside.
- **Tests.** `test/access-default.test.ts` (no `access` option, `users` plus a second auth collection `members`): a member can't create, edit or delete, or use merge, arrange, not-duplicate, similar or the rule preview (403, nothing changed); a member sees no drafts and an admin does; signed out is 401; an admin user writes and merges. `test/access-scoped.test.ts` (a rule answering `true` for a platform admin, `{ site: { in } }` for a curator, `false` for a member): a curator arranges and merges site A's events; arranging site B's, and every merge that touches site B (into, from, both, or mixed), is 404 with nothing changed; not-duplicate across sites is 404; a platform admin merges site B; a member is 403. Six non-answers (`1`, `'yes'`, `{}`, an array, a throw, a rejection): every endpoint is 403 and collection create, update and delete are 403 (never a 500), no drafts shown; a real query still scopes draft reads.
- **Mutation checks.** 15, each a Python string replace restored byte for byte (SHA-256 checked); all 15 fail the suite: the old default in the collections and in the endpoints; `adminUsersOnly` without the collection check; truthy answers passing; errors rethrown; an empty `{}` or an array taken as a query; the raw answer handed to collection access; draft reads taking any truthy answer; the endpoint skipping the event check under a query, checking only the first event, or leaving the query out of the lookup; merge not checking `from`; arrange not checking its event; not-duplicate not checking the other event.
- **Skipped.** The exported `arrangeDates` and `mergeEvents` functions don't gate themselves: they run as the request's user through Payload's access, and a site calling them directly decides who may. The `/:id/ics` endpoints read through Payload's read access and are unchanged.
- **For the lead.** The plugin's own default `defaultTimezone`, `UTC`, isn't in the timezone field's list (`Intl.supportedValuesOf('timeZone')` here has no `UTC`), so with no `defaultTimezone` creating any event fails validation. The new default-access test sets a timezone to get past it; not fixed here.

## 2026-11-09: fixed choices (field audit)

`test/events.test.ts` gains 1 (24 in all).

| Promise | Test |
| --- | --- |
| Start times only in 15-minute steps; venue countries only as known codes; the organizer stays free text | events: "takes start times only in 15-minute steps…" |

Not covered by a test: the organizer suggestions, which are a browser list fed from the signed-in person's own events. Checked in a browser on a local copy of a site instead: two earlier organizers offered, new text accepted, axe 0 on the field.

## 2026-11-09: core built

`test/rules.test.ts` (7) and `test/events.test.ts` (14), on Payload 3.92 with in-memory MongoDB and made-up events on two made-up sites.

| Promise | Test |
| --- | --- |
| The owner's every-other-month 3rd Thursday; plain-English summary; RFC text with DTSTART on the first real date | rules: "does the owner's example" |
| 7 pm stays 7 pm across daylight saving; spring-forward gap; fall-back repeat | rules: "keeps a 7 pm meeting…", "moves a time skipped…" |
| Last weekday of a month; months without the 31st; ends by date or count | rules |
| A year of dates in the event's timezone, with the site and appearance carried; top-up makes nothing twice | events: "makes a year of dates…" |
| A rule change redoes only untouched future dates; edited, protected, hand-made and past dates stay; turning recurring off | events: "redoes untouched future dates…" |
| Half-built rules can't be published | events: "refuses to publish…" |
| One-time events have one date; `appearsByDefault` | events: "lets a one-time event…" |
| Drop-off needs an appearance; appearances off per site | events: "needs an appearance…" |
| Geocoding on venue change only; a typed point kept; the usual venue copied | events: "looks up the venue's point…" |
| Slugs unique per site; deleting an event deletes its dates unless one is protected | events: "gives each event a slug…" |
| Visitors see only published events and their dates, can't write, and can't use the tools | events: "access" |
| Duplicates by name, organizer, website, venue; the right question; "not a duplicate" remembered | events: "duplicates" |
| Split plans first, keeps date ids, all-individual; refuses protected and rule-made dates | events: "merge and split" |
| Merge moves dates, removes the old events, old addresses redirect and aren't reused; refuses across sites | events: "merges single events…" |
| Near-me nearest first; drop-off only inside the window, with an appearance and drop-off, and not canceled | events: "near me and drop-off" |
| Calendar files: rule plus changed dates, escaping, folding at 75 octets | events: "calendar files" |

- Gaps skipped: the `preview-rule`, `similar` and `not-duplicate` endpoints are thin wrappers over tested functions. They'll be covered with the admin screens that call them.
- Browser pass, 2026-11-09, on a local copy of a real site with made-up events (Playwright + axe, WCAG 2.2 AA):
  - The live preview follows a weekday change before saving. The dates list shows the made dates.
  - A split plan is refused for a rule-made date. Merge moves the dates, removes the old event and keeps its address.
  - The duplicate warning appears while typing a name, and "It's a different event" clears it.
  - The calendar file's DTSTART is the first real 3rd Thursday.
  - axe: 0 on all three panels.
  - Fixed on the way: rrule loading under a bundler (Node and Next resolve it differently), and singular wording in the merge summary.
- Not tested: drag and drop by mouse (the "Move to" list was used), a real screen reader.
