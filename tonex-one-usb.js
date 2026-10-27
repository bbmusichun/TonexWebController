/*
 * TONEX ONE USB mode.
 *
 * The TONEX ONE does not speak standard MIDI over USB: it uses a CDC-ACM serial
 * link carrying HDLC-framed messages (0x7E delimited, CRC-CCITT). This file
 * implements that link in the browser (Web Serial on desktop Chrome, WebUSB on
 * Android) and translates the controller's MIDI CC / Program Change values into
 * the pedal's parameter and state messages.
 *
 * Protocol facts and framing/CRC handling follow the reverse engineering work in
 * https://github.com/vit3k/tonex_controller (MIT) and
 * https://github.com/yvr-vibe/txone-studio (MIT, Copyright (c) 2026 Sonny Min).
 * Parameter indices follow https://github.com/Builty/TonexOneController
 * (Apache-2.0, Copyright (C) 2025 Greg Smith).
 *
 * Unofficial, not affiliated with IK Multimedia. Use at your own risk.
 */
(function () {
    'use strict';

    const VID = 0x1963;
    const PID = 0x00d1;
    const FLAG = 0x7e;
    const ESC = 0x7d;

    const BRIDGE_HELP =
        'Ez a böngésző (Safari / iOS) nem ad USB-hozzáférést. Megoldás: hálózati híd — ' +
        'a pedálhoz USB-C kábellel kötött Macen futtasd: "python3 bridge/tonex-bridge.py", ' +
        'majd ezen az eszközön nyisd meg a híd által kiírt címet (pl. http://192.168.1.20:8765/).';

    // A híd ugyanazt az origin-t szolgálja ki, amiről az app betöltődött.
    function bridgeUrl() {
        if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) {
            throw new Error(BRIDGE_HELP);
        }
        return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }

    /* ------------------------------------------------------------------ *
     * Framing (HDLC asynchronous) + CRC-CCITT
     * ------------------------------------------------------------------ */

    function crc16(data) {
        let crc = 0xffff;
        for (const b of data) {
            crc ^= b;
            for (let i = 0; i < 8; i++) {
                crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
            }
        }
        return (crc ^ 0xffff) & 0xffff;
    }

    function frame(payload) {
        const crc = crc16(payload);
        const out = [FLAG];
        for (const b of [...payload, crc & 0xff, crc >>> 8]) {
            if (b === FLAG || b === ESC) out.push(ESC, b ^ 0x20);
            else out.push(b);
        }
        out.push(FLAG);
        return Uint8Array.from(out);
    }

    class FrameDecoder {
        constructor(onFrame, onError) {
            this.onFrame = onFrame;
            this.onError = onError || function () {};
            this.buffer = [];
            this.started = false;
            this.escape = false;
        }

        push(chunk) {
            for (const b of chunk) {
                if (b === FLAG) {
                    if (this.started && this.buffer.length && !this.escape) {
                        const d = Uint8Array.from(this.buffer);
                        const payload = d.slice(0, -2);
                        const crc = d[d.length - 2] | (d[d.length - 1] << 8);
                        if (d.length >= 3 && crc16(payload) === crc) this.onFrame(payload);
                        else this.onError('Hibás USB keret (CRC).');
                    }
                    this.started = true;
                    this.buffer = [];
                    this.escape = false;
                } else if (this.started) {
                    if (this.escape) {
                        this.buffer.push(b ^ 0x20);
                        this.escape = false;
                    } else if (b === ESC) {
                        this.escape = true;
                    } else {
                        this.buffer.push(b);
                    }
                    if (this.buffer.length > 65536) {
                        this.started = false;
                        this.buffer = [];
                        this.onError('Túl nagy USB keret.');
                    }
                }
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Messages
     * ------------------------------------------------------------------ */

    const wake = () => Uint8Array.from([0xb9, 3, 0, 0x82, 4, 0, 0x80, 0x0b, 1, 0xb9, 2, 2, 0x0b]);
    const requestState = () =>
        Uint8Array.from([0xb9, 3, 0, 0x82, 6, 0, 0x80, 0x0b, 3, 0xb9, 2, 0x81, 6, 3, 0x0b]);

    function floatBytes(value) {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, value, true);
        return new Uint8Array(view.buffer);
    }

    function setParameterMessage(index, value) {
        return Uint8Array.from([
            0xb9, 3, 0x81, 9, 3, 0x82, 10, 0, 0x80, 0x0b, 3,
            0xb9, 4, 2, 0, index, 0x88,
            ...floatBytes(value),
        ]);
    }

    function messageType(p) {
        if (p[0] === 0xb9 && p[1] === 3 && p[2] === 0x81) return p[3] | (p[4] << 8);
        return -1;
    }

    function readFloat(p, offset) {
        if (offset + 4 > p.length) throw new Error('Csonka üzenet.');
        return new DataView(p.buffer, p.byteOffset + offset, 4).getFloat32(0, true);
    }

    /**
     * Parses the pedal's "state changed" message. Layout verified against
     * firmware 1.2+ (the FX-era layout documented by TXOne-Studio). Unknown
     * layouts are rejected instead of guessed at.
     */
    function parseState(p) {
        if (messageType(p) !== 0x0306 || p.length < 40 || p[5] !== 0x80) {
            throw new Error('Ismeretlen állapotformátum (firmware?).');
        }
        const bodyStart = 8;
        let i = 22;
        const need = (n) => {
            if (i + n > p.length) throw new Error('Csonka állapot.');
        };
        need(5);
        if (p[i] !== 0x88) throw new Error('Ismeretlen állapotelrendezés.');
        const inputTrimOffset = ++i;
        i += 4;
        need(5);
        const modeOffset = i;
        i += 3;
        if (p[i++] !== 0xba || p[i++] !== 20) throw new Error('Ismeretlen színlista.');
        for (let n = 0; n < 20; n++) {
            need(2);
            if (p[i++] !== 0xb9 || p[i++] !== 3) throw new Error('Ismeretlen színbejegyzés.');
            for (let c = 0; c < 3; c++) {
                need(1);
                if (p[i++] === 0x80) {
                    need(1);
                    i++;
                }
            }
        }
        need(8);
        if (p[i++] !== 0xbc || p[i++] !== 6) throw new Error('Ismeretlen slotkiosztás.');
        const slotOffsets = [i, i + 2, i + 4];
        const slots = slotOffsets.map((o) => p[o] | (p[o + 1] << 8));
        i += 6;
        const bypassOffset = i++;
        const activeOffset = i++;
        const activeSlot = p[activeOffset];
        if (activeSlot > 2 || slots.some((s) => s > 19)) throw new Error('Érvénytelen slot érték.');
        return {
            raw: p.slice(),
            bodyStart,
            modeOffset,
            slotOffsets,
            activeOffset,
            bypassOffset,
            slots,
            activeSlot,
            inputTrimOffset,
        };
    }

    /** Rebuilds a state message from an existing state with one or two fields changed. */
    function mutateState(state, changes) {
        const raw = state.raw.slice();
        if (changes.slot !== undefined) {
            if (![0, 1, 2].includes(changes.slot)) throw new Error('Érvénytelen slot.');
            raw[state.activeOffset] = changes.slot;
            raw[state.modeOffset] = changes.slot === 2 ? 1 : 0;
            if (changes.slot !== 2) raw[state.bypassOffset] = 0;
        }
        if (changes.preset !== undefined) {
            const slot = changes.slot !== undefined ? changes.slot : state.activeSlot;
            if (!Number.isInteger(changes.preset) || changes.preset < 0 || changes.preset > 19) {
                throw new Error('Érvénytelen preset.');
            }
            const off = state.slotOffsets[slot];
            raw[off] = changes.preset & 0xff;
            raw[off + 1] = changes.preset >> 8;
        }
        const body = raw.slice(state.bodyStart);
        const header = raw.slice(0, 5);
        return Uint8Array.from([
            ...header,
            0x82, body.length & 0xff, body.length >> 8,
            0x80, 0x0b, 3,
            ...body,
        ]);
    }

    /* ------------------------------------------------------------------ *
     * Parameter table (TONEX ONE) and CC mapping
     * ------------------------------------------------------------------ */

    // index / min / max / kind — parameters the controller exposes.
    const PARAMS = {
        NOISE_GATE_POST: [0, 0, 1, 'switch'],
        NOISE_GATE_ENABLE: [1, 0, 1, 'switch'],
        NOISE_GATE_THRESHOLD: [2, -100, 0],
        NOISE_GATE_RELEASE: [3, 5, 500],
        NOISE_GATE_DEPTH: [4, -100, -20],
        COMP_POST: [5, 0, 1, 'switch'],
        COMP_ENABLE: [6, 0, 1, 'switch'],
        COMP_THRESHOLD: [7, -40, 0],
        COMP_MAKE_UP: [8, -30, 10],
        COMP_ATTACK: [9, 1, 51],
        EQ_POST: [10, 0, 1, 'switch'],
        EQ_BASS: [11, 0, 10],
        EQ_BASS_FREQ: [12, 75, 600],
        EQ_MID: [13, 0, 10],
        EQ_MIDQ: [14, 0.2, 3],
        EQ_MID_FREQ: [15, 150, 5000],
        EQ_TREBLE: [16, 0, 10],
        EQ_TREBLE_FREQ: [17, 1000, 4000],
        MODEL_GAIN: [20, 0, 10],
        MODEL_VOLUME: [21, 0, 10],
        MODEX_MIX: [22, 0, 100],
        MODEL_PRESENCE: [34, 0, 10],
        MODEL_DEPTH: [35, 0, 10],
        REVERB_ENABLE: [37, 0, 1, 'switch'],
        REVERB_MODEL: [38, 0, 5, 'select'],
        MODULATION_POST: [63, 0, 1, 'switch'],
        MODULATION_ENABLE: [64, 0, 1, 'switch'],
        MODULATION_MODEL: [65, 0, 4, 'select'],
        MODULATION_CHORUS_SYNC: [66, 0, 1, 'switch'],
        MODULATION_CHORUS_RATE: [68, 0.1, 10],
        MODULATION_CHORUS_DEPTH: [69, 0, 100],
        MODULATION_CHORUS_LEVEL: [70, 0, 10],
        MODULATION_TREMOLO_SYNC: [71, 0, 1, 'switch'],
        MODULATION_TREMOLO_RATE: [73, 0.1, 10],
        MODULATION_TREMOLO_SHAPE: [74, 0, 10],
        MODULATION_TREMOLO_SPREAD: [75, 0, 100],
        MODULATION_TREMOLO_LEVEL: [76, 0, 10],
        PHASER_SYNC: [77, 0, 1, 'switch'],
        PHASER_RATE: [79, 0.1, 10],
        PHASER_DEPTH: [80, 0, 100],
        PHASER_LEVEL: [81, 0, 10],
        FLANGER_SYNC: [82, 0, 1, 'switch'],
        FLANGER_RATE: [84, 0.1, 10],
        FLANGER_DEPTH: [85, 0, 100],
        FLANGER_FEEDBACK: [86, 0, 100],
        FLANGER_LEVEL: [87, 0, 10],
        ROTARY_SYNC: [88, 0, 1, 'switch'],
        ROTARY_SPEED: [90, 0, 400],
        ROTARY_RADIUS: [91, 0, 300],
        ROTARY_SPREAD: [92, 0, 100],
        ROTARY_LEVEL: [93, 0, 10],
        DELAY_POST: [94, 0, 1, 'switch'],
        DELAY_ENABLE: [95, 0, 1, 'switch'],
        DELAY_MODEL: [96, 0, 1, 'select'],
        DELAY_DIGITAL_SYNC: [97, 0, 1, 'switch'],
        DELAY_DIGITAL_TIME: [99, 0, 1000],
        DELAY_DIGITAL_FEEDBACK: [100, 0, 100],
        DELAY_DIGITAL_MODE: [101, 0, 1, 'select'],
        DELAY_DIGITAL_MIX: [102, 0, 100],
        DELAY_TAPE_SYNC: [103, 0, 1, 'switch'],
        DELAY_TAPE_TIME: [105, 0, 1000],
        DELAY_TAPE_FEEDBACK: [106, 0, 100],
        DELAY_TAPE_MODE: [107, 0, 1, 'select'],
        DELAY_TAPE_MIX: [108, 0, 100],
    };

    // Control-change number used by the controller -> parameter name.
    const CC_MAP = {
        102: 'MODEL_GAIN',
        23: 'EQ_BASS',
        25: 'EQ_MID',
        28: 'EQ_TREBLE',
        106: 'MODEL_PRESENCE',
        107: 'MODEL_DEPTH',
        103: 'MODEL_VOLUME',
        104: 'MODEX_MIX',
        24: 'EQ_BASS_FREQ',
        27: 'EQ_MID_FREQ',
        26: 'EQ_MIDQ',
        29: 'EQ_TREBLE_FREQ',
        30: 'EQ_POST',
        14: 'NOISE_GATE_ENABLE',
        15: 'NOISE_GATE_THRESHOLD',
        16: 'NOISE_GATE_RELEASE',
        17: 'NOISE_GATE_DEPTH',
        18: 'COMP_ENABLE',
        19: 'COMP_THRESHOLD',
        20: 'COMP_MAKE_UP',
        21: 'COMP_ATTACK',
        22: 'COMP_POST',
        75: 'REVERB_ENABLE',
        85: 'REVERB_MODEL',
        3: 'DELAY_MODEL',
        2: 'DELAY_ENABLE',
        1: 'DELAY_POST',
        4: 'DELAY_DIGITAL_SYNC',
        5: 'DELAY_DIGITAL_TIME',
        6: 'DELAY_DIGITAL_FEEDBACK',
        8: 'DELAY_DIGITAL_MIX',
        7: 'DELAY_DIGITAL_MODE',
        91: 'DELAY_TAPE_SYNC',
        92: 'DELAY_TAPE_TIME',
        93: 'DELAY_TAPE_FEEDBACK',
        95: 'DELAY_TAPE_MIX',
        94: 'DELAY_TAPE_MODE',
        33: 'MODULATION_MODEL',
        32: 'MODULATION_ENABLE',
        31: 'MODULATION_POST',
        34: 'MODULATION_CHORUS_SYNC',
        35: 'MODULATION_CHORUS_RATE',
        36: 'MODULATION_CHORUS_DEPTH',
        37: 'MODULATION_CHORUS_LEVEL',
        38: 'MODULATION_TREMOLO_SYNC',
        39: 'MODULATION_TREMOLO_RATE',
        40: 'MODULATION_TREMOLO_SHAPE',
        41: 'MODULATION_TREMOLO_SPREAD',
        42: 'MODULATION_TREMOLO_LEVEL',
        43: 'PHASER_SYNC',
        44: 'PHASER_RATE',
        45: 'PHASER_DEPTH',
        46: 'PHASER_LEVEL',
        47: 'FLANGER_SYNC',
        48: 'FLANGER_RATE',
        49: 'FLANGER_DEPTH',
        50: 'FLANGER_FEEDBACK',
        51: 'FLANGER_LEVEL',
        52: 'ROTARY_SYNC',
        53: 'ROTARY_SPEED',
        54: 'ROTARY_RADIUS',
        55: 'ROTARY_SPREAD',
        56: 'ROTARY_LEVEL',
    };

    // Reverb time / pre-delay / mix live in a block per reverb model.
    const REVERB_BLOCK = { time: 39, predelay: 40, mix: 42 };
    const REVERB_KNOB_CC = { 76: 'time', 77: 'predelay', 79: 'mix' };

    function ccToValue(def, ccValue) {
        const [index, min, max, kind] = def;
        const clamped = Math.max(0, Math.min(127, ccValue));
        const ratio = clamped / 127;
        if (kind === 'switch') return [index, ccValue >= 64 ? 1 : 0];
        let value = min + ratio * (max - min);
        if (kind === 'select') value = Math.round(value);
        return [index, value];
    }

    /* ------------------------------------------------------------------ *
     * Connection
     * ------------------------------------------------------------------ */

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    class ToneXOneUSB {
        constructor() {
            this.connected = false;
            this.transport = null;
            this.state = null;
            this.firmware = null;
            this.reverbModel = 0;
            this.queue = Promise.resolve();
            this.pending = null;
            this.reader = null;
            this.writer = null;
            this.readTask = null;
            this.generation = 0;
            this._statusHandlers = [];
            this.decoder = new FrameDecoder(
                (payload) => this.receive(payload),
                (message) => this.status(message, 'warn')
            );
        }

        onStatus(handler) {
            this._statusHandlers.push(handler);
        }

        status(text, kind) {
            for (const handler of this._statusHandlers) handler(text, kind || 'info');
        }

        /* ----- public API used by app.js ----- */

        sendCC(cc, value) {
            if (!this.connected) return;
            const target = CC_MAP[cc];
            if (!target) {
                const knob = REVERB_KNOB_CC[cc];
                if (!knob) return;
                // Time / pre-delay / mix of the currently selected reverb model.
                const index = REVERB_BLOCK[knob] + this.reverbModel * 4;
                const range = knob === 'time' ? 10 : knob === 'predelay' ? 500 : 100;
                const [, paramValue] = ccToValue([index, 0, range], value);
                this.sendParameter(index, paramValue);
                return;
            }
            if (target === 'REVERB_MODEL') this.reverbModel = Math.round((value / 127) * 5);
            const [index, paramValue] = ccToValue(PARAMS[target], value);
            this.sendParameter(index, paramValue);
        }

        sendPC(preset) {
            if (!this.connected || !this.state) return;
            if (!Number.isInteger(preset) || preset < 0 || preset > 19) {
                this.status('A TONEX ONE 20 presetet tárol (00A–06B), ezt nem tudom betölteni.', 'warn');
                return;
            }
            try {
                this.sendState(mutateState(this.state, { preset }));
                this.status('Preset ' + String(preset + 1).padStart(2, '0') + ' betöltve.', 'ok');
            } catch (error) {
                this.status(error.message, 'err');
            }
        }

        /* ----- internals ----- */

        sendParameter(index, value) {
            this.enqueue(() => this.write(setParameterMessage(index, value)));
        }

        sendState(payload) {
            this.enqueue(() => this.write(payload));
        }

        enqueue(fn) {
            const next = this.queue.then(fn);
            this.queue = next.catch(() => {});
            return next;
        }

        receive(payload) {
            if (messageType(payload) === 0x0306) {
                try {
                    this.state = parseState(payload);
                } catch (error) {
                    if (this.state) this.state = null;
                    this.status(error.message, 'warn');
                }
            }
            if (this.pending && messageType(payload) === this.pending.type) {
                const pending = this.pending;
                this.pending = null;
                clearTimeout(pending.timer);
                pending.resolve(payload);
            }
        }

        waitFor(type, timeout) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (this.pending && this.pending.timer === timer) this.pending = null;
                    reject(new Error('Nincs válasz a pedáltól.'));
                }, timeout);
                this.pending = { type, resolve, timer };
            });
        }

        async connect() {
            if (this.connected) return this.disconnect();
            try {
                if (typeof navigator !== 'undefined' && navigator.serial && !/Android/i.test(navigator.userAgent)) {
                    await this.connectSerial(navigator.serial);
                } else if (typeof navigator !== 'undefined' && navigator.usb) {
                    await this.connectUsb(navigator.usb);
                } else {
                    // iOS / iPadOS / Safari: nincs WebUSB, a Macen futó híd adja tovább a bájtokat.
                    await this.connectBridge(bridgeUrl());
                }
            } catch (error) {
                await this.close();
                const hint = /user gesture/i.test(error.message)
                    ? 'Kattints újra a gombra – a böngésző csak közvetlen kattintásra engedi az USB-választót.'
                    : error.message;
                this.status('USB hiba: ' + hint, 'err');
            }
        }

        // Hálózati híd (bridge/tonex-bridge.py): a híd csak nyers bájtokat továbbít,
        // a keretezés/CRC továbbra is itt, a böngészőben történik.
        async connectBridge(url) {
            if (typeof WebSocket === 'undefined') throw new Error(BRIDGE_HELP);
            const socket = new WebSocket(url);
            socket.binaryType = 'arraybuffer';
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    try { socket.close(); } catch (error) {}
                    reject(new Error(BRIDGE_HELP));
                }, 5000);
                socket.onopen = () => {
                    clearTimeout(timer);
                    resolve();
                };
                socket.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error(BRIDGE_HELP));
                };
            });

            this.socket = socket;
            this.transport = 'bridge';
            socket.onmessage = (event) => {
                if (typeof event.data === 'string') return;
                const data = new Uint8Array(event.data);
                if (data.length) this.decoder.push(data);
            };
            socket.onclose = () => {
                if (this.transport !== 'bridge' || this.socket !== socket) return;
                this.connected = false;
                this.socket = null;
                this.status('Híd kapcsolat megszakadt.', 'err');
            };
            await delay(150);
            await this.handshake('ToneX ONE (hálózati híd)');
        }

        async connectSerial(serial) {
            const port = await serial.requestPort({ filters: [{ usbVendorId: VID, usbProductId: PID }] });
            await port.open({
                baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none',
                flowControl: 'none', bufferSize: 65536,
            });
            await port.setSignals({ dataTerminalReady: true, requestToSend: true });
            this.transport = 'webserial';
            this.port = port;
            this.reader = port.readable.getReader();
            this.writer = port.writable.getWriter();
            this.readTask = this.readLoop(this.reader, this.generation);
            await delay(200);
            await this.handshake('ToneX ONE (USB serial)');
        }

        async connectUsb(usb) {
            const device = await usb.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
            await device.open();
            if (!device.configuration) {
                await device.selectConfiguration(device.configurations[0].configurationValue);
            }
            const interfaces = device.configuration.interfaces;
            const control = interfaces.find((i) =>
                i.alternates.some((a) => a.interfaceClass === 2 && a.interfaceSubclass === 2)
            );
            const data = interfaces.find((i) =>
                i.alternates.some(
                    (a) => a.interfaceClass === 10 &&
                        a.endpoints.some((e) => e.direction === 'in' && e.type === 'bulk') &&
                        a.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk')
                )
            );
            if (!control || !data) throw new Error('Nem található a pedál CDC interfésze.');
            await device.claimInterface(control.interfaceNumber);
            await device.claimInterface(data.interfaceNumber);
            const alt = data.alternates.find(
                (a) => a.interfaceClass === 10 &&
                    a.endpoints.some((e) => e.direction === 'in' && e.type === 'bulk')
            );
            if (data.alternate.alternateSetting !== alt.alternateSetting) {
                await device.selectAlternateInterface(data.interfaceNumber, alt.alternateSetting);
            }
            this.input = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
            this.output = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
            await device.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: control.interfaceNumber }, new Uint8Array([0x00, 0xc2, 0x01, 0x00, 0, 0, 8]));
            await device.controlTransferOut({ requestType: 'class', recipient: 'interface', request: 0x22, value: 3, index: control.interfaceNumber });
            this.transport = 'webusb';
            this.device = device;
            this.readTask = this.readLoopUsb(device, this.generation);
            await delay(200);
            await this.handshake('ToneX ONE (WebUSB)');
        }

        async handshake(name) {
            let ok = false;
            for (let attempt = 0; attempt < 5 && !ok; attempt++) {
                try {
                    try {
                        const identity = await this.exchange(wake(), 0x0b2b, 400);
                        if (identity.length >= 20) {
                            this.firmware = [identity[17], identity[18], identity[19]].join('.');
                        }
                    } catch (error) {
                        // An awake pedal may ignore the wake message; the state reply is what matters.
                    }
                    const statePayload = await this.exchange(requestState(), 0x0306, 1200);
                    this.state = parseState(statePayload);
                    ok = true;
                } catch (error) {
                    if (attempt === 4) throw error;
                    await delay(200);
                }
            }
            this.connected = true;
            this.status(
                name + ' csatlakoztatva' + (this.firmware ? ' (fw ' + this.firmware + ')' : '') + '.',
                'ok'
            );
        }

        async exchange(payload, type, timeout) {
            const wait = this.waitFor(type, timeout);
            await this.write(payload);
            return wait;
        }

        async write(payload) {
            const data = frame(payload);
            if (this.transport === 'webserial') {
                if (!this.writer) throw new Error('A pedál nincs csatlakoztatva.');
                await this.writer.write(data);
            } else if (this.transport === 'webusb') {
                if (!this.device) throw new Error('A pedál nincs csatlakoztatva.');
                await this.device.transferOut(this.output.endpointNumber, data);
            } else if (this.transport === 'bridge') {
                if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    throw new Error('A híd nincs csatlakoztatva.');
                }
                this.socket.send(data);
            }
        }

        async readLoop(reader, token) {
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (token !== this.generation || done) break;
                    if (value && value.length) this.decoder.push(value);
                }
            } catch (error) {
                if (token === this.generation) {
                    this.connected = false;
                    this.status('USB kapcsolat megszakadt: ' + error.message, 'err');
                }
            }
        }

        async readLoopUsb(device, token) {
            try {
                for (;;) {
                    const result = await device.transferIn(this.input.endpointNumber, 4096);
                    if (token !== this.generation) break;
                    if (result.data && result.data.byteLength) {
                        this.decoder.push(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength));
                    }
                }
            } catch (error) {
                if (token === this.generation) {
                    this.connected = false;
                    this.status('USB kapcsolat megszakadt: ' + error.message, 'err');
                }
            }
        }

        async disconnect() {
            await this.close();
            this.status('USB kapcsolat bontva.', 'info');
        }

        async close() {
            ++this.generation;
            this.connected = false;
            this.state = null;
            const reader = this.reader;
            const writer = this.writer;
            const port = this.port;
            const device = this.device;
            const socket = this.socket;
            this.reader = this.writer = this.port = this.device = this.socket = null;
            try {
                await reader?.cancel();
            } catch (error) {}
            if (socket) {
                try {
                    socket.close();
                } catch (error) {}
            }
            if (writer) {
                try {
                    await writer.close();
                } catch (error) {}
            }
            if (port) {
                try {
                    await port.close();
                } catch (error) {}
            }
            if (device) {
                try {
                    await device.close();
                } catch (error) {}
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * UI wiring
     * ------------------------------------------------------------------ */

    const usb = new ToneXOneUSB();
    window.tonexOneUsb = usb;

    function init() {
        const button = document.getElementById('usb-connect');
        const status = document.getElementById('usb-status');
        if (!button || !status) return;

        usb.onStatus((text, kind) => {
            status.textContent = text;
            status.className = 'usb-status ' + (kind || 'info');
            button.textContent = usb.connected ? 'USB bontása' : 'Csatlakozás USB-n';
            button.classList.toggle('connected', usb.connected);
        });

        button.addEventListener('click', () => {
            usb.connect();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exposed for tests.
    window.ToneXOneProtocol = {
        crc16, frame, FrameDecoder, parseState, mutateState,
        setParameterMessage, messageType, ccToValue, PARAMS, CC_MAP,
    };
})();
