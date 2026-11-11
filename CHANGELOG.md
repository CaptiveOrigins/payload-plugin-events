# Changelog

## 0.2.0 (2026-11-11)

- **Behavior change (2026-11-11): only admin users write by default.** With no `access.write`, any signed-in account of any auth collection, members included, could create, edit and delete events and use the merge and arrange endpoints. Now only users of the admin collection (`admin.user` in the Payload config) can. Sites relying on the old default must pass the option.
- **The write rule's answer is checked, not trusted.** Only `true` (any event) or a non-empty query (only events inside it) counts; any other truthy answer, an empty `{}`, an array, or an error is a no, answered 401 or 403 rather than a 500. This applies to the collection's access, draft reads and the endpoints.
- **A query from the write rule now scopes the endpoints.** Arrange dates, merge and "not a duplicate" load every event they name through the query and answer 404 if one is outside it. Before, a curator of one site could merge or arrange another site's events through them.
- **Fix (2026-11-11): a site with no `defaultTimezone` can create events.** The default, `UTC`, wasn't one of the timezone field's choices (`Intl.supportedValuesOf('timeZone')` leaves it out), so every new event failed validation. `UTC` is now the first choice. A `defaultTimezone` that isn't in the list is refused at start-up with a plain message, instead of failing on the first save.

Tested: 38 tests (2 new, in `test/default-timezone.test.ts`), 4 mutation checks for the timezone fix. Earlier in this release: 36 tests (9 new, in `test/access-default.test.ts` and `test/access-scoped.test.ts`), 15 mutation checks. Not yet tried on a site.

## 0.1.2 (2026-11-10)

Security fixes from a review of 0.1.1.

- **Drafts only for people who may change them.** Any signed-in account could read draft events and their dates. Now drafts are read only by those `access.write` lets in, and only where it lets them; everyone else, signed in or not, reads published ones. With the default write rule (anyone signed in) nothing changes. Pass `access.read` to replace it.
- **A date's copied fields always come from its event.** `copyToDates` values were copied only when the request sent none, so a date could be saved with another site than its event's. They're now replaced on create, on every edit and when a date moves to another event.

Tested: 27 tests (2 new; both fail without the fixes). Not yet tried on a site.

## 0.1.1 (2026-11-10)

- **Fix: sites with GraphQL couldn't build their schema.** A repeat rule's start time was a select field whose values ("19:00") became GraphQL enum names, and a colon isn't allowed in one. Payload refused to build the schema, which broke every GraphQL request on the site. The start time is now stored the same way, as "HH:MM" text, and validated to 15-minute steps. The admin still shows a select of times, through the new `TimeSelect` field component (`/client`). Saved rules don't change.
- New test: the GraphQL schema builds.

Tested: 25 tests, and in a browser on a local copy of a site: the picker lists 96 times, saves "19:00", and the site's GraphQL schema builds.

## 0.1.0 (2026-11-10)

First release, published by hand: events and their dates, repeat rules in each event's timezone, appearances and drop-off, near-me search, the duplicate check, merge and split, and calendar files.
