# Changelog

## 0.1.1 (2026-11-10)

- **Fix: sites with GraphQL couldn't build their schema.** A repeat rule's start time was a select field whose values ("19:00") became GraphQL enum names, and a colon isn't allowed in one. Payload refused to build the schema, which broke every GraphQL request on the site. The start time is now stored the same way, as "HH:MM" text, and validated to 15-minute steps. The admin still shows a select of times, through the new `TimeSelect` field component (`/client`). Saved rules don't change.
- New test: the GraphQL schema builds.

Tested: 25 tests, and in a browser on a local copy of a site: the picker lists 96 times, saves "19:00", and the site's GraphQL schema builds.

## 0.1.0 (2026-11-10)

First release, published by hand: events and their dates, repeat rules in each event's timezone, appearances and drop-off, near-me search, the duplicate check, merge and split, and calendar files.
