const knobConfigs = [
    { id: 'row1', knobs: [
        { cc: 102, name: 'Gain' },
        { cc: 23, name: 'Bass' },
        { cc: 25, name: 'Mid' },
        { cc: 28, name: 'Treble' },
        { cc: 106, name: 'Presence' },
        { cc: 107, name: 'Depth' },
        { cc: 103, name: 'Model volume' },
        { cc: 104, name: 'Dry/Wet signal' },
    ]},
    { id: 'row2', knobs: [
        { cc: 85, name: 'Reverb type' },
        { cc: 77, name: 'Pre-delay' },
        { cc: 76, name: 'Time' },
        { cc: 79, name: 'Mix' },
    ], toggle: { cc: 75, name: 'Reverb' }},
    { id: 'row3', knobs: [
        { cc: 15, name: 'Threshold' },
        { cc: 16, name: 'Release' },
        { cc: 17, name: 'Depth' },
    ], toggle: { cc: 14, name: 'Noise gate' }},
    { id: 'row4', knobs: [
        { cc: 19, name: 'Threshold' },
        { cc: 20, name: 'Gain' },
        { cc: 21, name: 'Attack' },
        { cc: 22, name: 'Pre/Post' },
    ], toggle: { cc: 18, name: 'Comp' }},
    { id: 'row5', knobs: [
        { cc: 24, name: 'Bass FRQ' },
        { cc: 27, name: 'Mid FRQ' },
        { cc: 26, name: 'Mid Q' },
        { cc: 29, name: 'Treble FRQ' },
        { cc: 30, name: 'EQ Pre/Post' },
    ], },
];

let midiOutput = null;
let midiChannel = 0; // Standardkanal 1

function createKnobs() {
    knobConfigs.forEach(({ id, knobs, toggle }) => {
        const row = document.getElementById(id);

        if (toggle) {
            const toggleButton = document.createElement('button');
            toggleButton.innerHTML = `${toggle.name}<br>On/Off`; 
            toggleButton.className = 'toggle-button';
            toggleButton.dataset.state = 'off';
            toggleButton.style.backgroundColor = '#D3D3D3';
            toggleButton.style.fontSize = '1em'; // Gör texten större
            toggleButton.style.fontWeight = 'bold'; // Gör texten fet
            //toggleButton.style.padding = '10px 20px'; // Lägg till padding
            toggleButton.style.borderRadius = '5px'; 
            toggleButton.addEventListener('click', () => {
                const newState = toggleButton.dataset.state === 'off' ? 'on' : 'off';
                toggleButton.dataset.state = newState;
                const value = newState === 'on' ? 127 : 0;
                toggleButton.style.backgroundColor = newState === 'on' ? '#00FF00' : '#D3D3D3';
                sendMIDICC(toggle.cc, value);
                console.log(`Toggle-knapp (CC ${toggle.cc}): Skickat värde ${value}`);
            });
            row.appendChild(toggleButton);
        }


        knobs.forEach(({ cc, name }) => {
            const knobContainer = document.createElement('div');
            knobContainer.className = 'knob-container';

            const canvas = document.createElement('canvas');
            canvas.className = 'knob';
            canvas.width = 100;
            canvas.height = 100;
            canvas.dataset.value = 63;
            canvas.dataset.cc = cc;
            drawKnob(canvas, 63);

            const label = document.createElement('div');
            label.className = 'label';
            const displayValue = ((63 / 127) * 10).toFixed(1); // Omräknat visningsvärde
            label.innerHTML = `${name}<br>${displayValue}`;

            knobContainer.appendChild(canvas);
            knobContainer.appendChild(label);
            row.appendChild(knobContainer);

            setupKnob(canvas, label);
        });


    });
}

function drawKnob(canvas, value) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fyll cirkeln
    // Skapa en radial gradient
    const gradient = ctx.createRadialGradient(50, 50, 20, 50, 50, 40);
    gradient.addColorStop(0, '#ffffff'); // Mittfärg
    gradient.addColorStop(1, '#abbaab'); // Kantfärg

    // Använd gradienten som fillStyle
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(50, 50, 40, 0, 2 * Math.PI);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(50, 50, 40, 0, 2 * Math.PI);
    ctx.stroke();

    // Beräkna rotationsvinkeln
    const startDegrees = 120;
    const endDegrees = 420;
    const minAngle = (startDegrees * Math.PI) / 180;
    const maxAngle = (endDegrees * Math.PI) / 180;
    const rotationAngle = minAngle + (value / 127) * (maxAngle - minAngle);

    // Rita notches med rotation
    const numNotches = 20;
    for (let i = 0; i < numNotches; i++) {
        const notchAngle = rotationAngle + (i / numNotches) * 2 * Math.PI;
        const innerRadius = 34;
        const outerRadius = 40;
        const x1 = 50 + innerRadius * Math.cos(notchAngle);
        const y1 = 50 + innerRadius * Math.sin(notchAngle);
        const x2 = 50 + outerRadius * Math.cos(notchAngle);
        const y2 = 50 + outerRadius * Math.sin(notchAngle);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // Rita indikatorn
    ctx.beginPath();
    ctx.moveTo(50, 50);
    ctx.lineTo(50 + 40 * Math.cos(rotationAngle), 50 + 40 * Math.sin(rotationAngle));
    ctx.stroke();
}

function setupKnob(canvas, label) {
    let startY = null;
    let value = parseInt(canvas.dataset.value, 10);
    const ccNumber = parseInt(canvas.dataset.cc, 10);

    function onPointerMove(event) {
        if (startY === null) return;

        const delta = startY - event.clientY;
        value = Math.max(0, Math.min(127, value + delta / 2));
        value = Math.round(value);
        canvas.dataset.value = value;
        startY = event.clientY;

        drawKnob(canvas, value);

        // Skala om värdet för visning
        const displayValue = ((value / 127) * 10).toFixed(1);
        label.innerHTML = `${label.innerHTML.split('<br>')[0]}<br>${displayValue}`;

        sendMIDICC(ccNumber, value);
    }

    // Pointer Events: egér, trackpad és érintés (iOS) egyaránt működik.
    canvas.addEventListener('pointerdown', (event) => {
        if (event.button > 0) return; // csak bal gomb / ujj
        event.preventDefault();
        startY = event.clientY;
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (error) {
            // Synthetic or already-released pointer: húzás capture nélkül is működik.
        }
    });
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', () => {
        startY = null;
    });
    canvas.addEventListener('pointercancel', () => {
        startY = null;
    });
}

function sendMIDICC(ccNumber, value) {
    // TONEX ONE USB mode (see tonex-one-usb.js) speaks the pedal's own protocol.
    if (window.tonexOneUsb && window.tonexOneUsb.connected) {
        window.tonexOneUsb.sendCC(ccNumber, value);
    }
    if (midiOutput) {
        const controlChangeMessage = [0xB0 + midiChannel, ccNumber, value];
        midiOutput.send(controlChangeMessage);
        console.log(`MIDI CC ${ccNumber} på kanal ${midiChannel + 1} skickat:`, value);
    }
}

function showSelectPlaceholder(select, text) {
    if (!select) return;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;
}

// iOS Safari (és a macOS Safari) nem ad Web MIDI / Web USB hozzáférést.
// Ilyenkor a felület használható marad, de ezt érthetően jelezzük.
function updateBrowserSupport() {
    const midiCapable = typeof navigator.requestMIDIAccess === 'function';
    const usbCapable = !!(navigator.serial || navigator.usb);
    const hint = document.getElementById('browser-hint');

    if (!hint || (midiCapable && usbCapable)) return;

    const warning = usbCapable
        ? 'Web MIDI nincs ebben a böngészőben, ezért a MIDI-es vezérlés nem elérhető — a TONEX ONE USB-mód viszont működik.'
        : 'A Safari nem ad USB-hozzáférést a pedálhoz. Megoldás: hálózati híd — a pedálhoz USB-C kábellel kötött Macen futtasd: "python3 bridge/tonex-bridge.py", majd ezen az eszközön nyisd meg a híd által kiírt címet (pl. http://192.168.1.20:8765/). Ott a Csatlakozás gomb már közvetlenül működik.';

    // Ha a Macen futó híd szolgálja ki az oldalt, nincs szükség figyelmeztetésre.
    fetch('bridge-status.json', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((info) => {
            if (info && info.bridge) {
                hint.textContent = 'Hálózati híd elérve (' + info.port + '). Kattints a Csatlakozás gombra.';
                hint.className = 'browser-hint ok';
            } else {
                hint.textContent = warning;
                hint.className = 'browser-hint';
            }
            hint.hidden = false;
        })
        .catch(() => {
            hint.textContent = warning;
            hint.hidden = false;
        });
}

async function initMIDI() {
    const select = document.getElementById('midi-outputs');

    if (typeof navigator.requestMIDIAccess !== 'function') {
        console.warn('A Web MIDI nem érhető el ebben a böngészőben (Safari / iOS).');
        showSelectPlaceholder(select, 'Web MIDI nem támogatott');
        return;
    }

    try {
        const midiAccess = await navigator.requestMIDIAccess();
        const outputs = Array.from(midiAccess.outputs.values());

        outputs.forEach((output, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = output.name;
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            midiOutput = outputs[select.selectedIndex];
            console.log(`Vald MIDI-utgång: ${midiOutput.name}`);
        });

        if (outputs.length > 0) {
            midiOutput = outputs[0];
            console.log(`Initial MIDI-utgång: ${midiOutput.name}`);
        } else {
            console.log('Ingen MIDI-utgång hittades');
        }

        document.getElementById('midi-channel').addEventListener('change', (event) => {
            midiChannel = parseInt(event.target.value);
            console.log(`Vald MIDI-kanal: ${midiChannel + 1}`);
        });

    } catch (error) {
        console.error('MIDI-åtkomst misslyckades:', error);
        showSelectPlaceholder(select, 'Nincs MIDI-engedély');
    }
}
document.querySelectorAll('.bank-select').forEach(select => {
    for (let i = 1; i <= 50; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Bank ${i}`;
        select.appendChild(option);
    }
});

document.querySelectorAll('.cluster').forEach(cluster => {
    const bankSelect = cluster.querySelector('.bank-select');
    const buttons = cluster.querySelectorAll('.toggle-btn');

    bankSelect.addEventListener('change', () => {
        updateButtons(buttons, bankSelect.value);
        highlightCluster(cluster);
    });

    buttons.forEach((button, index) => {
        button.addEventListener('click', () => {
            const bank = parseInt(bankSelect.value, 10);
            const pcValue = (bank - 1) * 3 + index;
            sendMIDIPC(pcValue);

            buttons.forEach(btn => btn.classList.remove('selected'));
            button.classList.add('selected');

            highlightCluster(cluster);
        });
    });
});

function highlightCluster(selectedCluster) {
    document.querySelectorAll('.cluster').forEach(cluster => {
        cluster.classList.remove('selected');
    });
    selectedCluster.classList.add('selected');
}

function updateButtons(buttons, bank) {
    // Uppdatera knapplogik om det behövs
}

function sendMIDIPC(pcValue) {
    if (window.tonexOneUsb && window.tonexOneUsb.connected) {
        window.tonexOneUsb.sendPC(pcValue);
    }
    if (midiOutput) {
        const programChangeMessage = [0xC0 + midiChannel, pcValue];
        midiOutput.send(programChangeMessage);
        console.log(`MIDI PC skickat: ${pcValue}`);
    }
}


function createKnobElement(cc, name) {
    const knobContainer = document.createElement('div');
    knobContainer.className = 'knob-container';

    const canvas = document.createElement('canvas');
    canvas.className = 'knob';
    canvas.width = 100;
    canvas.height = 100;
    canvas.dataset.value = 63;
    canvas.dataset.cc = cc;
    drawKnob(canvas, 63);

    const label = document.createElement('div');
    label.className = 'label';
    const displayValue = ((63 / 127) * 10).toFixed(1);
    label.innerHTML = `${name}<br>${displayValue}`;

    knobContainer.appendChild(canvas);
    knobContainer.appendChild(label);

    setupKnob(canvas, label);

    return knobContainer;
}

function renderKnobsForOption(knobs) {
    const knobContainer = document.createElement('div');
    knobContainer.className = 'knob-group';

    knobs.forEach(({ cc, name }) => {
        const knobElem = createKnobElement(cc, name);
        knobContainer.appendChild(knobElem);
    });

    const existingKnobGroup = document.querySelector('#new-module .knob-group');
    if (existingKnobGroup) {
        existingKnobGroup.remove();
    }

    document.getElementById('new-module').appendChild(knobContainer);
}

function createNewModule() {
    const moduleContainer = document.getElementById('new-module');

    const rowContainer = document.createElement('div');
    rowContainer.className = 'flex-row';

    const dropdown = document.createElement('select');
    const options = [
        { name: 'Chorus', knobs: [{ cc: 35, name: 'Rate' }, { cc: 36, name: 'Depth' }, { cc: 36, name: 'Level' }] },
        { name: 'Tremolo', knobs: [{ cc: 39, name: 'Rate' }, { cc: 40, name: 'Shape' }, { cc: 41, name: 'Spread' }, { cc: 42, name: 'Level' }] },
        { name: 'Phaser', knobs: [{ cc: 44, name: 'Rate' }, { cc: 45, name: 'Depth' }, { cc: 46, name: 'Level' }] },
        { name: 'Flanger', knobs: [{ cc: 48, name: 'Rate' }, { cc: 49, name: 'Depth' }, { cc: 50, name: 'Feedback' }, { cc: 51, name: 'Level' }] },
        { name: 'Rotary', knobs: [{ cc: 53, name: 'Speed' }, { cc: 54, name: 'Radius' }, { cc: 55, name: 'Spread' }, { cc: 56, name: 'Level' }] }
    ];

    options.forEach((opt, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = opt.name;
        dropdown.appendChild(option);
    });

    dropdown.addEventListener('change', () => {
        const selectedOption = options[dropdown.selectedIndex];
        renderKnobsForOption(selectedOption.knobs, rowContainer, dropdown, mainToggle, secondToggle, slideToggle, options);

        sendMIDICC(33, dropdown.selectedIndex);
        console.log(`Dropdown ändrat: Skickat CC#33 med värde ${dropdown.selectedIndex}`);
    });

    rowContainer.appendChild(dropdown);

    const mainToggle = document.createElement('button');
    mainToggle.innerHTML = 'MOD FX<br>On/Off';
    mainToggle.className = 'toggle-button';
    mainToggle.dataset.state = 'off';
    mainToggle.addEventListener('click', () => {
        const newState = mainToggle.dataset.state === 'off' ? 'on' : 'off';
        mainToggle.dataset.state = newState;
        const value = newState === 'on' ? 127 : 0;
        sendMIDICC(32, value);
        console.log(`MOD FX<br>On/Off: Skickat värde ${value}`);
    });

    rowContainer.appendChild(mainToggle);

    const toggleCCs = [34, 38, 43, 47, 52];
    const secondToggle = document.createElement('button');
    secondToggle.innerHTML = 'SYNC<br>On/Off'; 
    secondToggle.className = 'toggle-button';
    secondToggle.dataset.state = 'off';
    secondToggle.addEventListener('click', () => {
        const newState = secondToggle.dataset.state === 'off' ? 'on' : 'off';
        secondToggle.dataset.state = newState;
        const value = newState === 'on' ? 127 : 0;
        const ccNumber = toggleCCs[dropdown.selectedIndex];
        sendMIDICC(ccNumber, value);
        console.log(`Dynamic Toggle: Skickat CC#${ccNumber} med värde ${value}`);
    });

    rowContainer.appendChild(secondToggle);

    const slideToggleContainer = document.createElement('div');
    slideToggleContainer.className = 'slide-toggle-container';
    slideToggleContainer.setAttribute('data-left', 'Off');
    slideToggleContainer.setAttribute('data-right', 'On');

    const slideToggle = document.createElement('input');
    slideToggle.type = 'checkbox';
    slideToggle.className = 'slide-toggle';
    slideToggle.id = 'slideToggle';
    slideToggle.addEventListener('change', () => {
        const value = slideToggle.checked ? 127 : 0;
        sendMIDICC(31, value);
        console.log(`Slide Toggle: Skickat CC#31 med värde ${value}`);
    });

    const slideToggleLabel = document.createElement('label');
    slideToggleLabel.className = 'slide-toggle-label';
    slideToggleLabel.setAttribute('for', 'slideToggle');
    slideToggleLabel.innerHTML = '';

    slideToggleContainer.appendChild(slideToggle);
    slideToggleContainer.appendChild(slideToggleLabel);
    rowContainer.appendChild(slideToggleContainer);

    moduleContainer.appendChild(rowContainer);

    renderKnobsForOption(options[0].knobs, rowContainer, dropdown, mainToggle, secondToggle, slideToggle, options);
}

function renderKnobsForOption(knobs, rowContainer, dropdown, mainToggle, secondToggle, slideToggle, options) {
    const knobGroup = document.createElement('div');
    knobGroup.className = 'knob-group';

    knobs.forEach(({ cc, name }) => {
        const knobElem = createKnobElement(cc, name);
        knobGroup.appendChild(knobElem);
    });

    const existingKnobGroup = rowContainer.querySelector('.knob-group');
    if (existingKnobGroup) {
        existingKnobGroup.remove();
    }

    rowContainer.appendChild(knobGroup);

    // Ta bort tidigare "Send All MIDI"-knapp om den finns
    const existingSendAllButton = rowContainer.querySelector('.advanced-button');
    if (existingSendAllButton) {
        existingSendAllButton.remove();
    }

    const toggleCCs = [34, 38, 43, 47, 52];
    const sendAllButton = document.createElement('button');
    sendAllButton.innerHTML = 'Apply all';
    sendAllButton.className = 'advanced-button';
    sendAllButton.addEventListener('click', () => {
        sendMIDICC(33, dropdown.selectedIndex);
        console.log(`Send All: Skickat CC#33 med värde ${dropdown.selectedIndex}`);

        const mainToggleValue = mainToggle.dataset.state === 'on' ? 127 : 0;
        sendMIDICC(32, mainToggleValue);
        console.log(`Send All: Skickat CC#32 med värde ${mainToggleValue}`);

        const dynamicToggleValue = secondToggle.dataset.state === 'on' ? 127 : 0;
        const dynamicToggleCCNumber = toggleCCs[dropdown.selectedIndex];
        sendMIDICC(dynamicToggleCCNumber, dynamicToggleValue);
        console.log(`Send All: Skickat CC#${dynamicToggleCCNumber} med värde ${dynamicToggleValue}`);

        const slideToggleValue = slideToggle.checked ? 127 : 0;
        sendMIDICC(31, slideToggleValue);
        console.log(`Send All: Skickat CC#55 med värde ${slideToggleValue}`);

        const selectedOption = options[dropdown.selectedIndex];
        selectedOption.knobs.forEach(knob => {
            const knobElement = document.querySelector(`canvas[data-cc="${knob.cc}"]`);
            if (knobElement) {
                const knobValue = parseInt(knobElement.dataset.value, 10);
                sendMIDICC(knob.cc, knobValue);
                console.log(`Send All: Skickat CC#${knob.cc} med värde ${knobValue}`);
            }
        });
    });

    rowContainer.appendChild(sendAllButton);
}



function createDelayModule() {
    const moduleContainer = document.getElementById('delay-module');

    const rowContainer = document.createElement('div');
    rowContainer.className = 'flex-row';

    // Dropdown för delay-typ
    const delayTypeDropdown = document.createElement('select');
    const delayOptions = [
        { 
            name: 'Digital', 
            ccValue: 0, 
            knobs: [{ cc: 5, name: 'Time' }, { cc: 6, name: 'Feedback' }, { cc: 8, name: 'Mix' }],
            syncCC: 4,  // CC för Sync Toggle
            modeCC: 7,  // CC för Mode
            modeOptions: [
                { name: 'Normal', ccValue: 0 },
                { name: 'Ping Pong', ccValue: 127 }
            ]
        },
        { 
            name: 'Tape', 
            ccValue: 1, 
            knobs: [{ cc: 92, name: 'Time' }, { cc: 93, name: 'Feedback' }, { cc: 95, name: 'Mix' }],
            syncCC: 91,  // CC för Sync Toggle
            modeCC: 94, // CC för Mode
            modeOptions: [
                { name: 'Normal', ccValue: 0 },
                { name: 'Ping Pong', ccValue: 127 }
            ]
        }
    ];

    delayOptions.forEach((opt, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = opt.name;
        delayTypeDropdown.appendChild(option);
    });

    delayTypeDropdown.addEventListener('change', () => {
        const selectedOption = delayOptions[delayTypeDropdown.selectedIndex];
        renderDelayKnobs(selectedOption.knobs, rowContainer, delayTypeDropdown, onOffToggle, syncToggle, modeDropdown, slideToggle, delayOptions);
        sendMIDICC(3, selectedOption.ccValue);
        console.log(`Delay Type: Skickat CC#3 med värde ${selectedOption.ccValue}`);

        // Uppdatera modeDropdown med rätt alternativ
        updateModeDropdown(modeDropdown, selectedOption.modeOptions);
    });

    rowContainer.appendChild(delayTypeDropdown);

    // On/Off-knapp
    const onOffToggle = document.createElement('button');
    onOffToggle.innerHTML = 'On/Off<br>Delay';
    onOffToggle.className = 'toggle-button';
    onOffToggle.dataset.state = 'off';
    onOffToggle.addEventListener('click', () => {
        const newState = onOffToggle.dataset.state === 'off' ? 'on' : 'off';
        onOffToggle.dataset.state = newState;
        const value = newState === 'on' ? 127 : 0;
        sendMIDICC(2, value);
        console.log(`On/Off Toggle: Skickat CC#2 med värde ${value}`);
    });

    rowContainer.appendChild(onOffToggle);

    // Sync Toggle-knapp
    const syncToggle = document.createElement('button');
    syncToggle.innerHTML = 'Sync<br>On/Off';
    syncToggle.className = 'toggle-button';
    syncToggle.dataset.state = 'off';
    syncToggle.addEventListener('click', () => {
        const selectedOption = delayOptions[delayTypeDropdown.selectedIndex];
        const newState = syncToggle.dataset.state === 'off' ? 'on' : 'off';
        syncToggle.dataset.state = newState;
        const value = newState === 'on' ? 127 : 0;
        sendMIDICC(selectedOption.syncCC, value);
        console.log(`Sync Toggle: Skickat CC#${selectedOption.syncCC} med värde ${value}`);
    });

    rowContainer.appendChild(syncToggle);

    // Dropdown för mode
    const modeDropdown = document.createElement('select');
    updateModeDropdown(modeDropdown, delayOptions[0].modeOptions);

    modeDropdown.addEventListener('change', () => {
        const selectedOption = delayOptions[delayTypeDropdown.selectedIndex];
        const selectedModeOption = selectedOption.modeOptions[modeDropdown.selectedIndex];
        sendMIDICC(selectedOption.modeCC, selectedModeOption.ccValue);
        console.log(`Mode: Skickat CC#${selectedOption.modeCC} med värde ${selectedModeOption.ccValue}`);
    });

    rowContainer.appendChild(modeDropdown);

    // Slide Toggle
    const slideToggleContainer = document.createElement('div');
    slideToggleContainer.className = 'slide-toggle-container';
    slideToggleContainer.setAttribute('data-left', 'Off');
    slideToggleContainer.setAttribute('data-right', 'On');

    const slideToggle = document.createElement('input');
    slideToggle.type = 'checkbox';
    slideToggle.className = 'slide-toggle';
    slideToggle.id = 'delaySlideToggle';
    slideToggle.addEventListener('change', () => {
        const value = slideToggle.checked ? 127 : 0;
        sendMIDICC(1, value);
        console.log(`Slide Toggle: Skickat CC#1 med värde ${value}`);
    });

    const slideToggleLabel = document.createElement('label');
    slideToggleLabel.className = 'slide-toggle-label';
    slideToggleLabel.setAttribute('for', 'delaySlideToggle');
    slideToggleLabel.innerHTML = '';

    slideToggleContainer.appendChild(slideToggle);
    slideToggleContainer.appendChild(slideToggleLabel);
    rowContainer.appendChild(slideToggleContainer);

    moduleContainer.appendChild(rowContainer);

    renderDelayKnobs(delayOptions[0].knobs, rowContainer, delayTypeDropdown, onOffToggle, syncToggle, modeDropdown, slideToggle, delayOptions);
}

function updateModeDropdown(dropdown, modeOptions) {
    dropdown.innerHTML = ''; // Rensa befintliga alternativ
    modeOptions.forEach((opt, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = opt.name;
        dropdown.appendChild(option);
    });
}

function renderDelayKnobs(knobs, rowContainer, delayTypeDropdown, onOffToggle, syncToggle, modeDropdown, slideToggle, delayOptions) {
    const knobGroup = document.createElement('div');
    knobGroup.className = 'knob-group';

    knobs.forEach(({ cc, name }) => {
        const knobElem = createKnobElement(cc, name);
        knobGroup.appendChild(knobElem);
    });

    const existingKnobGroup = rowContainer.querySelector('.knob-group');
    if (existingKnobGroup) {
        existingKnobGroup.remove();
    }

    rowContainer.appendChild(knobGroup);

    // Ta bort tidigare "Send All MIDI"-knapp om den finns
    const existingSendAllButton = rowContainer.querySelector('.advanced-button');
    if (existingSendAllButton) {
        existingSendAllButton.remove();
    }

    const sendAllButton = document.createElement('button');
    sendAllButton.innerHTML = 'Send All MIDI';
    sendAllButton.className = 'advanced-button';
    sendAllButton.addEventListener('click', () => {
        const selectedDelayOption = delayOptions[delayTypeDropdown.selectedIndex];
        sendMIDICC(3, selectedDelayOption.ccValue);
        console.log(`Send All: Skickat CC#3 med värde ${selectedDelayOption.ccValue}`);

        const onOffValue = onOffToggle.dataset.state === 'on' ? 127 : 0;
        sendMIDICC(2, onOffValue);
        console.log(`Send All: Skickat CC#2 med värde ${onOffValue}`);

        const syncValue = syncToggle.dataset.state === 'on' ? 127 : 0;
        sendMIDICC(selectedDelayOption.syncCC, syncValue);
        console.log(`Send All: Skickat CC#${selectedDelayOption.syncCC} med värde ${syncValue}`);

        const selectedModeOption = selectedDelayOption.modeOptions[modeDropdown.selectedIndex];
        sendMIDICC(selectedDelayOption.modeCC, selectedModeOption.ccValue);
        console.log(`Send All: Skickat CC#${selectedDelayOption.modeCC} med värde ${selectedModeOption.ccValue}`);

        const slideToggleValue = slideToggle.checked ? 127 : 0;
        sendMIDICC(1, slideToggleValue);
        console.log(`Send All: Skickat CC#1 med värde ${slideToggleValue}`);

        selectedDelayOption.knobs.forEach(knob => {
            const knobElement = document.querySelector(`canvas[data-cc="${knob.cc}"]`);
            if (knobElement) {
                const knobValue = parseInt(knobElement.dataset.value, 10);
                sendMIDICC(knob.cc, knobValue);
                console.log(`Send All: Skickat CC#${knob.cc} med värde ${knobValue}`);
            }
        });
    });

    rowContainer.appendChild(sendAllButton);
}

createDelayModule();


createNewModule();

createKnobs();
updateBrowserSupport();
initMIDI();