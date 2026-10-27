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

## iOS / mobil
The page is also a home-screen web app:
- `manifest.webmanifest` + `apple-mobile-web-app-*` meta tags, `viewport-fit=cover` and
  `env(safe-area-inset-*)` padding in `style.css` (`display: standalone`, `theme-color`).
  `nginx.conf` serves `manifest.webmanifest` as `application/manifest+json` (the alpine
  `mime.types` has no entry for it).
- Knobs use **Pointer Events** (`pointerdown`/`pointermove`/`pointerup`), not mouse events,
  so touch dragging works on iOS; `canvas.knob { touch-action: none }` stops the page from
  scrolling/zooming while a knob is dragged.
- Layout: `.row`/`.module` wrap (`max-width: 100%`, `flex-wrap: wrap`) plus a
  `@media (max-width: 700px)` block. Without it the knob rows were ~735 px wide on a 375 px
  iPhone screen and got clipped (body is a centred flex box, so the clipped part was
  unreachable) — that is the "does not open / broken on iPhone" symptom.
- Safari (iOS and macOS) has **no** Web MIDI, Web Serial or WebUSB (Apple has no plans to add
  them), so Apple browsers reach the pedal through the **network bridge** (`bridge/tonex-bridge.py`,
  stdlib-only Python 3, runs on the Mac that has the pedal on USB). It serves this same static
  app plus a `/ws` WebSocket that is a dumb byte pipe — framing/CRC stay in the browser — so
  `connectBridge()` in `tonex-one-usb.js` uses the same handshake as Web Serial. `connect()`
  falls back to it when neither `navigator.serial` nor `navigator.usb` exists.
  `updateBrowserSupport()` in `app.js` shows `#browser-hint` with instructions on those
  browsers, and turns it into a green "híd elérve" note when `GET /bridge-status.json`
  (served by the bridge) answers. `initMIDI()` puts a placeholder in the device select instead
  of failing silently. Do not remove that messaging to "clean up" the UI.
  The bridge page must be opened over plain `http://<lan-ip>:8765/` — an `https` page cannot
  open a `ws://` socket (mixed content), which is exactly why the bridge serves the app itself.
- Avoid `backdrop-filter` on `body`: WebKit can render the whole page blank with it.

## Natív iOS app (`ios/`)
`ios/ToneXController.xcodeproj` is a real iOS app that reaches the pedal over **USB** — the one
thing Safari cannot do. iOS has no Web MIDI / Web Serial / WebUSB, but it *does* have
**CoreMIDI**, which sees class-compliant USB-MIDI devices through a USB-C/Lightning camera
adapter (so ToneX Pedal and TONEX ONE+ work; the original TONEX ONE's proprietary CDC-ACM link
still needs `bridge/tonex-bridge.py`).

- The UI is **not** rewritten: the app is a `WKWebView` loading this repo's `index.html` +
  `app.js`, plus an "Copy web app" build-script phase that copies the root web files into the
  bundle's `Web/` folder on every build. Keep that file list in the phase in sync if a new
  root-level script is added.
- `native-midi.js` (root, loaded **before** `tonex-one-usb.js` and `app.js`) installs a
  `navigator.requestMIDIAccess` shim backed by `window.webkit.messageHandlers.tonexMIDI`, so
  `initMIDI()`/`sendMIDICC()`/`sendMIDIPC()` in `app.js` work unchanged. It returns immediately
  when that handler is absent, so the website is unaffected. `app.js`'s
  `updateBrowserSupport()` returns early on `window.tonexNative` to suppress the "Safari has no
  USB" warning inside the app.
- Message protocol: JS posts `{id, action: "list"}` / `{id, action: "send", target, bytes}`;
  Swift answers `list` by evaluating `window.tonexNative._resolve(id, true, [<devices>])` and
  pushes device changes with `window.tonexNative._devicesChanged([...])` on CoreMIDI
  `msgSetupChanged`. Device ids are CoreMIDI `kMIDIPropertyUniqueID` values.
- **Cannot be built or run in this sandbox** (no macOS/Xcode, no simulator, no signing). Treat
  the Swift code as unverified here; only the web side is testable (the shim is inert in a
  browser). Edit Swift with that in mind: be conservative, no clever shortcuts.
- Build/install steps for the user are in `ios/README.md` (Xcode → Signing team → Run; free
  Apple ID builds expire after 7 days).


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
- Bridge, without hardware: create a pty (`python3 -c "import pty; ..."`), run
  `python3 bridge/tonex-bridge.py --port <pty-slave> --http-port 8765`, then talk to
  `ws://127.0.0.1:8765/ws`. Bytes sent by the client must appear untouched on the pty, and
  bytes written to the pty must come back as binary WebSocket frames; `GET /` must serve
  `index.html` and `GET /bridge-status.json` must answer `{"bridge": true, ...}`.
- USB protocol layer is testable without hardware: load `tonex-one-usb.js` in Node with a stub
  `window`/`document` and check `window.ToneXOneProtocol` (CRC/framing, `parseState`,
  `mutateState`, `ccToValue`). The documented hello frame must frame to
  `7e b9 03 00 82 04 00 80 0b 01 b9 02 02 0b 17 8c 7e`.
