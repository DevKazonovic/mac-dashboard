# Contributing to mac-dashboard

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Run it from a clone

```sh
git clone https://github.com/DevKazonovic/mac-dashboard.git
cd mac-dashboard
npm run dev
```

There is nothing to install. mac-dashboard has no dependencies and no build step; you need macOS and Node.js 18.11 or newer for `npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs it at http://127.0.0.1:3739 and restarts it every time you save a file in `src` or `bin`. Refresh the page after you change `public`. |
| `npm run demo` | Runs it with made-up data at http://127.0.0.1:3799, to work on the page or take screenshots without showing your own apps. |
| `npm start` | Runs it once in the terminal, like `mac-dashboard` does. |
| `npm test` | Runs the tests with Node's built-in test runner. |
| `npm run check` | Checks the syntax of every file. |

## How it is built

| File | What it does |
| --- | --- |
| `src/sampler.js` | Keeps one `top` running and reads `ps`, `sysctl`, `vm_stat`, `df`, `lsof` and `docker` every 5 seconds. |
| `src/classify.js` | Turns hundreds of processes into the apps people know: browsers, editors, Docker, Gradle, dev servers. |
| `src/checks.js` | Decides the verdict and what needs attention. |
| `src/present.js` | Turns all of that into the text the page shows. |
| `src/storage.js` | Measures caches and build folders once an hour. |
| `src/commands.js` | The `start`, `stop`, `restart`, `status`, `enable`, `disable` and `update` commands. |
| `src/demo.js` | The made-up data for `npm run demo`. |
| `public/` | The page. It only renders what the server sends. |

## Guidelines

- Keep it free of dependencies. Use what Node.js and macOS already have.
- Never send a process's command line to the page. Show app names, folder names and sizes only.
- Never delete or change anything on the user's Mac. The dashboard only reads.
- Write page text in plain, everyday words, and put explanations in the info tooltips.
- Add or update a test when you change how a number is read or a process is grouped.
- Run `npm test` and `npm run check` before you open a pull request.

## Reporting a security problem

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
