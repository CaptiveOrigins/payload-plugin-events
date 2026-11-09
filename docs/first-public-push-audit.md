# First-public-push audit

Run 2026-11-09 by the Web Platform session, before the repo goes public (per ~/Code/CLAUDE.md), after the owner's yes to "audit then public". Visibility is changed by the owner, not by this audit.

| Check | Result |
| --- | --- |
| Commit authors (all history) | Only the noreply address (11632652+mgilardi@users.noreply.github.com) |
| Secrets in history (Stripe, AWS, GitHub, Slack, Resend keys, private keys, database URLs with passwords) | None found. The test secret `test-secret-not-for-production` and the test password are made up |
| Email addresses in tracked files | Only `staff@example.invalid` in the tests |
| Server addresses, IPs, private hosts | None |
| Build output, dependencies, env files committed | None (`dist/`, `node_modules/`, `.env`, `.secrets/` are ignored) |
| Private terms (`scripts/leak-check.sh` locally, with ~/.leak-private-terms) | Passed |
| Leak check in CI | Yes, first step of `.github/workflows/ci.yml` |
| LICENSE | MIT, Copyright (c) 2026 Captive Origins (added in this audit) |
| `package.json` | `private` removed so it can be published; licence, repository, homepage, bugs and `files` set; typecheck and tests run before publish |
| Release workflow and RELEASING.md | Added, the same as the other Captive Origins packages |
| README status line says what has and hasn't been tested | Yes |
| Details of a real site | None. The tests use made-up events, and the README's example mentions kits only as one site's reason to protect a date |

## Notes

- An earlier version of `docs/decisions.md` named the platform repo's plan file. It's only a file name, with nothing about how the site is set up or secured, so the history is kept as it is. The current file says only that the plan is in the private platform repo.
- `CLAUDE.md` is the standard ops starter file, as in payload-plugin-hats. It isn't in the npm package. It names local paths under the owner's code folder and nothing else.

Result: clean.
