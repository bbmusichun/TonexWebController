# AGENTS.md

## Project
Static, build-less website: a browser MIDI controller for the IK Multimedia ToneX pedal.
`index.html` + `app.js` + `style.css` + `png/` at the repo root are the live version;
`old/` and `beta/` are archived copies kept for reference (do not wire them up).

There is **no** package.json, bundler, backend, database or external service.
Talks to hardware only through the browser Web MIDI API (`navigator.requestMIDIAccess`,
already wrapped in `try/catch`, so a browser without MIDI access simply logs an error and
the UI still works). No credentials or secrets of any kind are required.

## Running it (sandbox / Base44)
```
docker compose -f docker-compose.base44.yml up -d
```
Serves the repo on host port **3000** with `nginx:alpine`, bind-mounted read-only, so edits
appear on refresh (no live-reload dev server; call a preview reload after changes).

`nginx.conf` is the full nginx config mounted at `/etc/nginx/nginx.conf`. It runs the workers
as `root` because the sandbox clone is root-owned with restrictive (`700`) directory
permissions — a default nginx worker user gets `403 Forbidden` on the mounted files.

## Verifying
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200`
- Page should render 30 knobs (`canvas.knob`), 50 options per bank select, and the
  Delay/Modulation modules built by `createDelayModule()` / `createNewModule()`.
- No build, lint or test tooling exists in this repo.
