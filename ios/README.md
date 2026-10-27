# ToneX Controller — natív iOS app

Ez a mappa egy valódi iOS appot tartalmaz, amivel az iPhone/iPad **USB-n** éri el a pedált.
A weboldal (iOS Safariban) ezt nem tudja: Apple nem ad Web MIDI / Web Serial / WebUSB
hozzáférést. A natív app viszont a **CoreMIDI**-t használja, ami iOS-en hivatalosan eléri a
class-compliant **USB-MIDI** eszközöket.

A felület nem lett újraírva: a `WKWebView` ugyanazt az `index.html` + `app.js` párost tölti be,
amit a weboldal, a `native-midi.js` pedig egy `navigator.requestMIDIAccess` shimet tesz be,
ami a bájtokat a Swift oldalra továbbítja. Így egy forrás van: a repó gyökere.

## Mi működik és mi nem

| Pedál | iOS-en |
| --- | --- |
| **ToneX Pedal** (nagy) | ✅ USB-C/Lightning adapteren át, CoreMIDI |
| **TONEX ONE+** (USB-MIDI) | ✅ ugyanígy |
| **TONEX ONE** (eredeti) | ❌ a saját CDC-ACM protokollja iOS-en nem nyitható meg (nincs általános USB API) — erre való a `bridge/tonex-bridge.py` hálózati híd |

Kellék: **USB-C / Lightning Camera Adapter** (a sima töltő-adapter nem jó), iOS 15 vagy újabb,
Xcode 15 vagy újabb (a buildhez, Macen).

## Build és telepítés

1. `open ios/ToneXController.xcodeproj` (Macen, Xcode 15+).
2. Target → **Signing & Capabilities** → *Team*: válaszd a saját Apple ID-det (ingyenes is elég).
   Ha ütközik a bundle id, írd át a `PRODUCT_BUNDLE_IDENTIFIER`-t (pl. `hu.sajatnev.tonex`).
3. Válaszd ki az iPhone-t, majd **Run** (⌘R).

iPhone-on az első indítás után: *Beállítások → Általános → VPN és eszközkezelés* → a fejlesztői
profil megbízhatósítása. Ingyenes Apple ID-vel a build **7 naponta lejár**, utána újra kell
telepíteni; App Store-hoz fizetős Apple Developer Program kell.

## Használat

1. USB-C / Lightning adapter → pedál USB kábellel (nem kell MIDI kábel).
2. Az app tetején zöld pont + az eszköz neve = a pedál látszik. Ha nem: dugd be, majd a
   ⟳ (frissítés) gomb.
3. Ugyanaz a felület, mint a weboldalon: MIDI-csatorna, bank/preset gombok, knobok.
   A pedálon a MIDI legyen *Through* vagy *Merge*.

## Felépítés

- `ToneXApp.swift` — `@main` SwiftUI app.
- `ControllerView.swift` — állapotsáv (CoreMIDI állapot + frissítés) és a `WKWebView`
  (`Coordinator` kezeli a `tonexMIDI` script-üzeneteket: `list` / `send`).
- `TonexMIDI.swift` — CoreMIDI kliens: kimenetek listázása, `msgSetupChanged` figyelése,
  CC/PC bájtok küldése `MIDISend`-del.
- `native-midi.js` (a repó gyökerében) — a fenti kettő közötti JS shim; böngészőben nem
  csinál semmit, mert csak akkor indul el, ha létezik `window.webkit.messageHandlers.tonexMIDI`.
- A **Copy web app** build script fázis másolja a gyökérből a bundle `Web/` mappájába az
  `index.html`, `app.js`, `style.css`, `native-midi.js`, `tonex-one-usb.js` fájlokat és a `png/`
  képeket — így a webes felület javításai azonnal benne vannak az appban is (build után).

## Ismert korlátok

- Ez a környezet (Linux sandbox) nem tud iOS appot fordítani: Xcode és macOS kell hozzá.
  Az `ios/` forrás **nincs lefordítva/tesztelve** itt, a webes felület viszont változatlanul
  működik (a shim böngészőben inaktív).
- A webes felület egyirányú: a knobok nem frissülnek a pedálról visszajövő állapotból
  (ez a weboldalon is így van).
- Az app nem hálózati hídként működik: az eredeti TONEX ONE-hoz továbbra is a Macen futó
  bridge kell.
