# Security policy

## Supported versions

Only the newest version gets fixes. Update with `mac-dashboard update`.

## Reporting a vulnerability

Please report it privately through [GitHub's private vulnerability reporting](https://github.com/DevKazonovic/mac-dashboard/security/advisories/new), not in a public issue.

## How the dashboard protects you

- It listens only on `127.0.0.1`, so other devices on your network can't reach it.
- It answers only requests addressed to `127.0.0.1` or `localhost` on its own port, which blocks DNS rebinding.
- Its one action, measuring folders again, accepts only requests from its own page.
- It runs read-only commands with fixed arguments and no shell, and never deletes or changes anything.
- It never sends a process's command line to the page, because command lines can hold passwords and tokens.
- It never contacts any server.
- Its page has a strict Content Security Policy and shows every value as plain text.

Like Activity Monitor, the page shows which apps, programs, services and containers run on your Mac, and which ports they listen on. Any program that already runs as your user can open it too.
