# Decisions

Dated decisions for this repo, newest last.

- 2026-11-09: created from the standard repo starter kit.
- 2026-11-09: the owner's plan lives in the private platform repo (approved in principle 2026-11-09, with his answers).
- 2026-11-09 (build): **wall-clock times.** Rules are worked out in floating time with the open-source `rrule` library, then turned into real instants in the event's timezone. A time skipped by spring-forward moves on by the gap; a repeated fall-back time takes the first.
- 2026-11-09 (build): **generated dates keep their slot.** Each made date records the rule it came from and its original start. A person's edit marks it `edited`, and the rule never touches it again, even if it was moved.
- 2026-11-09 (build): **calendar DTSTART is the first real occurrence**, never the rule's start day, because calendars count DTSTART as a date even when it's off the rule.
- 2026-11-09 (build): **appearance and drop-off.** Newly ticking drop-off without an appearance is refused. Turning the appearance off just ends drop-off.
- 2026-11-09 (build): **distance in code.** Near-me filters a bounded date window by great-circle distance, so it needs no geo index on the site's database.
- 2026-11-09 (build): **the duplicate check is a live notice, not a question at save.** It shows while a new event's name, organizer or website is typed, with "add a date to it instead" (or "make it reusable"), and "It's a different event". Stopping Payload's save to ask would mean replacing its save button. Nothing is merged without a person's yes either way.
- 2026-11-09 (build): **dates are added from the event's page** through a join field, so a new date comes pre-linked.
- 2026-11-09 (later): the owner said yes to going public after the first-public-push audit. MIT, like the other general Payload plugins. He changes the visibility and publishes 0.1.0 himself.
- 2026-11-09 (field audit): **fixed choices where a list exists.** The rule's start time is a choice in 15-minute steps (stored as 24-hour "HH:MM", shown as "7:00 pm"), the venue country a choice of ISO codes, and the organizer box suggests earlier events' organizers while still taking anything new. Owner's brief G: nothing that has a known list stays plain text.
- 2026-11-11 (access sweep): **write access fails closed.** With no `access.write`, only users of the admin collection (`admin.user`) write; before, any signed-in account of any auth collection could. Only `true` or a non-empty query from the rule counts; anything else, an error included, is no (401 or 403). A query scopes the endpoints: every event a request names must be inside it, else 404, so curators keep working on their own sites only (a refinement from the first site's review). Sites relying on the old default must pass the option.
- 2026-11-13: moved to the ExtantApe GitHub organization and the `@extantape` npm scope at the same version. EXTANT APE owns its reusable tools and licenses them to the platform. The earlier package name is deprecated with a pointer here, and GitHub redirects the old repository address.
