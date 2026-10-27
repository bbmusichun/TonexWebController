/*
 * Natív iOS híd — csak az `ios/ToneXController` WKWebView-jában aktiválódik.
 *
 * Az iOS Safari nem ad Web MIDI / Web Serial / WebUSB hozzáférést, ezért a natív
 * app a CoreMIDI-t használja: class-compliant USB-MIDI pedálok (ToneX Pedal,
 * TONEX ONE+) USB-C / Lightning adapteren át működnek. Ez a fájl a webes felület
 * ELÉ töltődik be, és egy `navigator.requestMIDIAccess` shimet tesz be, ami
 * ugyanazt az API-t adja, amit az app.js használ — a bájtokat a Swift oldalra
 * továbbítja (`window.webkit.messageHandlers.tonexMIDI`).
 *
 * Böngészőben (nincs `window.webkit.messageHandlers.tonexMIDI`) semmit nem csinál,
 * így a weboldal működése változatlan.
 */
(function () {
    var handlers = window.webkit && window.webkit.messageHandlers;
    if (!handlers || !handlers.tonexMIDI) return;

    var pending = Object.create(null);
    var sequence = 0;
    var access = null;
    var outputs = new Map();

    // Üzenet a Swift oldalnak; a választ a `_resolve(id, ok, adat)` hozza vissza.
    function call(action, payload) {
        return new Promise(function (resolve, reject) {
            var id = ++sequence;
            pending[id] = { resolve: resolve, reject: reject };
            try {
                handlers.tonexMIDI.postMessage(Object.assign({ id: id, action: action }, payload || {}));
            } catch (error) {
                delete pending[id];
                reject(error);
            }
        });
    }

    // Tűz-és-felejts üzenet (nincs válasz): a knobok mozgatása sok üzenetet ad,
    // nem tartunk nyitva egy Promise-t mindegyikhez.
    function post(action, payload) {
        try {
            handlers.tonexMIDI.postMessage(Object.assign({ action: action }, payload || {}));
        } catch (error) {
            console.error('Natív MIDI küldési hiba:', error);
        }
    }

    function rebuild(list) {
        outputs = new Map();
        (list || []).forEach(function (device) {
            var targetId = Number(device.id);
            var port = {
                id: String(device.id),
                name: device.name || 'MIDI',
                manufacturer: device.manufacturer || '',
                type: 'output',
                state: 'connected',
                connection: 'open',
                send: function (bytes) {
                    post('send', { target: targetId, bytes: Array.prototype.slice.call(bytes) });
                },
                clear: function () {}
            };
            outputs.set(port.id, port);
        });
        if (access) access.outputs = outputs;
    }

    Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        writable: true,
        value: function () {
            return call('list').then(function (list) {
                access = {
                    inputs: new Map(),
                    outputs: new Map(),
                    sysexEnabled: false,
                    onstatechange: null
                };
                rebuild(list);
                return access;
            });
        }
    });

    window.tonexNative = {
        midi: true,
        _resolve: function (id, ok, data) {
            var request = pending[id];
            if (!request) return;
            delete pending[id];
            if (ok) request.resolve(data);
            else request.reject(new Error(String(data)));
        },
        // A Swift oldal hívja, amikor a pedált bedugják vagy kihúzzák.
        _devicesChanged: function (list) {
            rebuild(list);
            if (access && typeof access.onstatechange === 'function') {
                access.onstatechange({ port: null });
            }
        }
    };

    // A "Csatlakozás USB-n" gomb Web Serial/WebUSB-t nyitna, ami iOS-en nem létezik;
    // a natív CoreMIDI kapcsolat már a fenti listában van, ezért a blokkot elrejtjük.
    document.addEventListener('DOMContentLoaded', function () {
        var box = document.querySelector('.usb-box');
        if (box) box.hidden = true;

        var hint = document.getElementById('browser-hint');
        if (hint) {
            hint.textContent = 'Natív iOS app: a pedál USB-C adapteren át, CoreMIDI-n keresztül kapcsolódik. '
                + 'Ha nem jelenik meg a MIDI-eszközök között, dugd be a pedált, majd érintsd meg a felül a frissítés ikont.';
            hint.className = 'browser-hint ok';
            hint.hidden = false;
        }
    });
})();
