# AGENTS.md

## Project
Static, build-less website: a browser MIDI controller for the IK Multimedia ToneX pedal.
`index.html` + `app.js` + `style.css` + `png/` at the repo root are the live version;
`old/` and `beta/` are archived copies kept for reference (do not wire them up).

There is **no** package.json, bundler, backend, database or external service.
Two hardware paths exist:

1. **MIDI** (`app.js`): the big ToneX Pedal (and ToneX ONE+ via its 3.5 mm MIDI) through the
   browser Web MIDI API (`navigator.requestMIDIAccess`, already wrapped in `try/catch`, so a
   browser without MIDI access logs an error and the UI still works).
2. **TONEX ONE USB** (`tonex-one-usb.js`): the original TONEX ONE has **no MIDI over USB** — it
   speaks a proprietary CDC-ACM link with HDLC-framed messages (`0x7E` delimited, CRC-CCITT).
   `tonex-one-usb.js` implements it over Web Serial (desktop Chrome/Edge) or WebUSB (Android).
   `sendMIDICC()` / `sendMIDIPC()` in `app.js` forward to `window.tonexOneUsb` when connected,
   so every knob/toggle/preset button works in both modes.

No credentials or secrets of any kind are required.

Protocol references (all open source, credited in the file header): vit3k/tonex_controller
(protocol notes, MIT), yvr-vibe/txone-studio (framing/CRC + state layout, MIT),
Builty/TonexOneController (parameter indices, Apache-2.0).

Gotchas worth knowing before touching the USB code:
- Outgoing *set state* messages use the header `0x82 <size> 0x80 0x0b 03`, while the pedal's
  incoming *state changed* messages use `0x80 <size>`; the body therefore starts at byte 11
  outgoing and byte 8 incoming. Do not feed a locally built state message back into
  `parseState()` — it is not the same layout.
- A TONEX ONE stores 20 presets, so preset buttons above that are refused with a status message.
- Web Serial only opens from a real user click (the browser rejects `requestPort` otherwise).

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
- USB protocol layer is testable without hardware: load `tonex-one-usb.js` in Node with a stub
  `window`/`document` and check `window.ToneXOneProtocol` (CRC/framing, `parseState`,
  `mutateState`, `ccToValue`). The documented hello frame must frame to
  `7e b9 03 00 82 04 00 80 0b 01 b9 02 02 0b 17 8c 7e`.
