# Hi, this is a hobbyproject where you can control your ToneX Pedal from your browser.
# Now updated from the beta to new version with FX support. Old version at https://bearwolf.github.io/TonexWebController/old
[Access it as a webpage here!](https://bearwolf.github.io/TonexWebController/)
    
    1. Connect pedal via cable. Make sure Midi is set to 'Through' or 'Merge' on the tonex.
    2. Choose ToneX as midi device (refesh page if ToneX is not showing).
    3. Choose midichannel if you've changed it.
    DISCLAIMER: The information is one way, the knobs won't know what your settings are until you move them here. 

## iPhone / iPad – natív app (USB-vel)

Az iOS Safariból a pedál USB-n nem érhető el (Apple nem ad Web MIDI / Web USB hozzáférést).
Ezért van a repóban egy **natív iOS app** (`ios/`): ugyanez a felület `WKWebView`-ban, de a
MIDI a rendszer **CoreMIDI**-ján megy ki, ami USB-C / Lightning Camera Adapteren át eléri a
class-compliant USB-MIDI pedálokat (**ToneX Pedal**, **TONEX ONE+**).

1. Macen: `open ios/ToneXController.xcodeproj` (Xcode 15+).
2. Signing & Capabilities → válaszd ki a saját Apple ID-det (ingyenes is elég).
3. iPhone kiválasztása → **Run**. Első indítás után a telefonon: Beállítások → Általános →
   VPN és eszközkezelés → a profil megbízhatósítása.
4. Az app tetején zöld pont és az eszköz neve jelzi, hogy a pedál látszik.

Részletek, korlátok és a felépítés: [ios/README.md](ios/README.md).
Az eredeti **TONEX ONE** (a saját CDC-ACM protokollal) iOS-en továbbra sem nyitható meg — arra
való a lenti hálózati híd.

## iPhone / iPad (Safari) – hálózati híd

Az iOS Safari (és a macOS Safari) nem ad USB-hozzáférést a weboldalaknak, ezért a TONEX ONE
iPhone-ból közvetlenül nem vezérelhető. Erre való a híd: egy kis Python szkript a Macen, ami
USB-n a pedálhoz csatlakozik, és a böngészőnek ugyanazt a bájtfolyamot továbbítja Wi-Fi-n.

1. Dugd a TONEX ONE-t USB-C **adatkábellel** a Machez.
2. A repó gyökerében: `python3 bridge/tonex-bridge.py`
   (ha nem találja a portot: `python3 bridge/tonex-bridge.py --list`, majd `--port /dev/tty.usbmodem...`)
3. A kiírt címet nyisd meg az iPhone Safariban, pl. `http://192.168.1.20:8765/` — ez ugyanaz az
   app; a **Csatlakozás** gomb a hídon keresztül éri el a pedált. (Telepítés: Megosztás →
   Főképernyőhöz adás.)
4. A telefon és a Mac legyen ugyanazon a Wi-Fi-n.

Csak Python 3 kell hozzá, semmit nem kell telepíteni (macOS/Linux). A híd nem értelmezi a
protokollt — a HDLC keretezés és a CRC a böngészőben marad —, csak nyers bájtokat továbbít.
Windowson maradj a Chrome/Edge közvetlen USB-módjánál.
