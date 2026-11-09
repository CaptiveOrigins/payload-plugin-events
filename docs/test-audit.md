# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

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
| Near-me nearest first; drop-off only inside the window, with an appearance and drop-off, and not cancelled | events: "near me and drop-off" |
| Calendar files: rule plus changed dates, escaping, folding at 75 octets | events: "calendar files" |

- Gaps skipped: the `preview-rule`, `similar` and `not-duplicate` endpoints are thin wrappers over tested functions. They'll be covered with the admin screens that call them.
- Not built yet: the admin screens.
