# Decisions

Dated decisions for this repo, newest last.

- 2026-11-09: created from the ops starter kit, area `captive-origins`.
- 2026-11-09: the owner's plan is `captive-origins/docs/events-plugin-plan.md` (approved in principle 2026-11-09, with his answers). This repo stays private until his yes.
- 2026-11-09 (build): **wall-clock times.** Rules are worked out in floating time with the open-source `rrule` library, then turned into real instants in the event's timezone. A time skipped by spring-forward moves on by the gap; a repeated fall-back time takes the first.
- 2026-11-09 (build): **generated dates keep their slot.** Each made date records the rule it came from and its original start. A person's edit marks it `edited`, and the rule never touches it again, even if it was moved.
- 2026-11-09 (build): **calendar DTSTART is the first real occurrence**, never the rule's start day, because calendars count DTSTART as a date even when it's off the rule.
- 2026-11-09 (build): **appearance and drop-off.** Newly ticking drop-off without an appearance is refused. Turning the appearance off just ends drop-off.
- 2026-11-09 (build): **distance in code.** Near-me filters a bounded date window by great-circle distance, so it needs no geo index on the site's database.
