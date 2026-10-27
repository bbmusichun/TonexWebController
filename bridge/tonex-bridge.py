#!/usr/bin/env python3
"""
TONEX ONE hálózati híd.

Miért kell: az iPhone/iPad Safari (és a macOS Safari) nem ad WebUSB / Web Serial
hozzáférést, így böngészőből nem tud közvetlenül a pedálhoz szólni. Ez a híd a
számítógépen (Mac / Linux / Raspberry Pi) fut, USB-n a pedálhoz csatlakozik, és a
böngészőnek ugyanazt a nyers bájtfolyamot adja tovább WebSocketen, mintha Web
Serial lenne. A protokoll (HDLC keretezés, CRC) végig a böngészőben marad — a híd
csak egy átlátszó cső.

Használat:
    python3 bridge/tonex-bridge.py                 # port automatikus keresése
    python3 bridge/tonex-bridge.py --port /dev/tty.usbmodem1234
    python3 bridge/tonex-bridge.py --list          # elérhető soros portok
    python3 bridge/tonex-bridge.py --http-port 8765

Utána az iPhone Safariban a kiírt címet kell megnyitni (pl. http://192.168.1.20:8765/).
A híd ugyanezen a porton szolgálja ki magát a webappot is, így a böngészőben a
WebSocket ugyanarról az originről megy — nincs HTTPS/mixed-content probléma.

Csak Python 3 szükséges, semmit nem kell telepíteni (macOS/Linux).
"""

import argparse
import base64
import glob
import hashlib
import mimetypes
import os
import socket
import struct
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(BRIDGE_DIR)

mimetypes.add_type("application/manifest+json", ".webmanifest")

# A TONEX ONE CDC-ACM portja (a Web Serial kód is 115200 8N1-gyel nyit).
BAUD = 115200


def find_pedal_port(explicit=None):
    """Visszaadja a soros portot: a megadottat, vagy az első talált CDC-ACM eszközt."""
    if explicit:
        return explicit
    for pattern in ("/dev/tty.usbmodem*", "/dev/tty.usbmodem*", "/dev/ttyACM*"):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[0]
    return None


def list_ports():
    ports = []
    for pattern in ("/dev/tty.usbmodem*", "/dev/ttyACM*", "/dev/cu.*", "/dev/ttyUSB*"):
        ports.extend(sorted(glob.glob(pattern)))
    return sorted(set(ports))


def lan_address():
    """A gép LAN IP-je, hogy a telefon elérhesse (nem a 127.0.0.1)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())
    finally:
        sock.close()


class Client:
    """Egy WebSocket kliens (a böngésző). Bájtokat ad-vesz, semmit nem értelmez."""

    def __init__(self, conn):
        self.conn = conn
        self.lock = threading.Lock()
        self.alive = True

    def send_binary(self, data):
        self._send(0x2, data)

    def _send(self, opcode, payload=b""):
        header = bytearray([0x80 | opcode])
        size = len(payload)
        if size < 126:
            header.append(size)
        elif size < 65536:
            header.append(126)
            header += struct.pack(">H", size)
        else:
            header.append(127)
            header += struct.pack(">Q", size)
        with self.lock:
            if not self.alive:
                return
            try:
                self.conn.sendall(bytes(header) + payload)
            except OSError:
                self.alive = False

    def _read(self, count):
        buf = b""
        while len(buf) < count:
            chunk = self.conn.recv(count - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def read_loop(self, pedal):
        try:
            while self.alive:
                head = self._read(2)
                if head is None:
                    break
                opcode = head[0] & 0x0F
                masked = head[1] & 0x80
                size = head[1] & 0x7F
                if size == 126:
                    ext = self._read(2)
                    if ext is None:
                        break
                    size = struct.unpack(">H", ext)[0]
                elif size == 127:
                    ext = self._read(8)
                    if ext is None:
                        break
                    size = struct.unpack(">Q", ext)[0]
                mask = self._read(4) if masked else None
                if masked and mask is None:
                    break
                payload = self._read(size) if size else b""
                if payload is None:
                    break
                if mask:
                    payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                if opcode == 0x2:
                    pedal.write(payload)
                elif opcode == 0x8:
                    break
                elif opcode == 0x9:
                    self._send(0xA, payload)
        except OSError:
            pass
        finally:
            self.alive = False
            try:
                self.conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Pedal:
    """A pedál soros portja: nyers olvasás/írás, a kliensek felé szórva."""

    def __init__(self, path):
        self.path = path
        self.fd = None
        self.clients = []
        self.lock = threading.Lock()

    def open(self):
        import termios

        self.fd = os.open(self.path, os.O_RDWR | os.O_NOCTTY)
        attrs = termios.tcgetattr(self.fd)
        attrs[0] = 0  # iflag: nincs CR/LF átalakítás
        attrs[1] = 0  # oflag
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL | termios.CSTOPB & 0
        attrs[3] = 0  # lflag: nincs echo / canonical
        attrs[4] = attrs[5] = termios.B115200
        attrs[6][termios.VMIN] = 1
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
        self._set_modem_lines()

    def _set_modem_lines(self):
        """DTR + RTS, ahogy a Web Serial út is teszi — enélkül a pedál nem válaszol."""
        try:
            import fcntl
            import struct as _struct
        except ImportError:
            return
        if sys.platform == "darwin":
            request, bits = 0x8004746C, 0x002 | 0x004  # TIOCMBIS, DTR|RTS
        elif sys.platform.startswith("linux"):
            request, bits = 0x5416, 0x002 | 0x004
        else:
            return
        try:
            fcntl.ioctl(self.fd, request, _struct.pack("i", bits))
        except OSError:
            pass

    def add_client(self, client):
        with self.lock:
            self.clients.append(client)
        print("[hid] bongeszo csatlakozott (%d aktiv)" % len(self.clients), flush=True)

    def remove_client(self, client):
        with self.lock:
            if client in self.clients:
                self.clients.remove(client)
        print("[hid] bongeszo lecsatlakozott (%d aktiv)" % len(self.clients), flush=True)

    def write(self, data):
        if not data:
            return
        with self.lock:
            try:
                os.write(self.fd, data)
            except OSError as error:
                print("[hid] irasi hiba: %s" % error, flush=True)

    def read_loop(self):
        while True:
            try:
                data = os.read(self.fd, 4096)
            except OSError as error:
                print("[hid] olvasasi hiba: %s" % error, flush=True)
                data = b""
            if not data:
                break
            with self.lock:
                clients = list(self.clients)
            for client in clients:
                client.send_binary(data)
        print("[hid] a pedal kapcsolata megszakadt.", flush=True)
        with self.lock:
            clients, self.clients = list(self.clients), []
        for client in clients:
            client.alive = False
            try:
                client.conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    pedal = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if "/ws" in (self.path or ""):
            return
        sys.stderr.write("[http] %s\n" % (fmt % args))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/ws":
            self.handle_websocket()
            return
        if path == "/bridge-status.json":
            # Az app ebből tudja, hogy híd szolgálja ki (nincs szükség Safari-figyelmeztetésre).
            body = ('{"bridge": true, "port": "%s", "baud": %d}' % (self.pedal.path, BAUD)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.split("?")[0] == "/ws":
            self.send_error(400, "WebSocket only")
            return
        super().do_HEAD()

    def handle_websocket(self):
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing Sec-WebSocket-Key")
            return
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.wfile.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: %s\r\n\r\n" % accept
            ).encode()
        )
        self.wfile.flush()

        client = Client(self.connection)
        self.pedal.add_client(client)
        try:
            client.read_loop(self.pedal)
        finally:
            self.pedal.remove_client(client)
        self.close_connection = True


def main():
    parser = argparse.ArgumentParser(
        description="TONEX ONE hálózati híd (USB -> WebSocket) az iPhone/iPad böngészőjéhez."
    )
    parser.add_argument("--port", help="soros port, pl. /dev/tty.usbmodem1234")
    parser.add_argument("--http-port", type=int, default=8765, help="a webapp/híd portja (alap: 8765)")
    parser.add_argument("--host", default="0.0.0.0", help="figyelt cím (alap: 0.0.0.0)")
    parser.add_argument("--list", action="store_true", help="soros portok listázása és kilépés")
    args = parser.parse_args()

    if args.list:
        ports = list_ports()
        print("Soros portok:" if ports else "Nem találtam soros portot.")
        for port in ports:
            print("  " + port)
        return 0

    if not sys.platform.startswith("linux") and sys.platform != "darwin":
        print("Ez a híd macOS/Linux alatt fut. Windowson használd a Chrome-ot közvetlen USB-vel.")
        return 1

    path = find_pedal_port(args.port)
    if not path:
        print("Nem találtam a TONEX ONE-t. Dugd be USB-C adatkábellel, vagy add meg: --port /dev/...")
        print("Elérhető portok:")
        for port in list_ports():
            print("  " + port)
        return 1

    pedal = Pedal(path)
    try:
        pedal.open()
    except OSError as error:
        print("A(z) %s portot nem tudom megnyitni: %s" % (path, error))
        print("Tipp: zárd be a ToneX szerkesztőt / más programot, ami használhatja a portot.")
        return 1

    reader = threading.Thread(target=pedal.read_loop, daemon=True)
    reader.start()

    Handler.pedal = pedal
    server = ThreadingHTTPServer((args.host, args.http_port), Handler)
    url = "http://%s:%d/" % (lan_address(), args.http_port)

    print("TONEX ONE hálózati híd fut.")
    print("  pedal : %s (%d 8N1)" % (path, BAUD))
    print("  iPhone: %s  <- ezt nyisd meg Safariban" % url)
    print("  leallitas: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLeallitva.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
