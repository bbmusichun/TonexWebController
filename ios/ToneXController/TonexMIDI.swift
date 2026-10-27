import Foundation
import Combine
import CoreMIDI

/// Egy CoreMIDI kimeneti végpont (a pedál) a webes felület felé.
struct MidiDestination: Identifiable, Equatable {
    let id: Int32
    let name: String
    let manufacturer: String
}

/// CoreMIDI kimenet az iOS apphoz.
///
/// iOS-en ez az egyetlen járható USB-út a pedál felé: a class-compliant USB-MIDI
/// eszközök (ToneX Pedal, TONEX ONE+) USB-C / Lightning adapteren át közvetlenül
/// elérhetők. Az eredeti TONEX ONE saját CDC-ACM protokollja iOS-en nem nyitható
/// meg (nincs általános USB/soros API), arra továbbra is a hálózati híd való.
final class TonexMIDI: ObservableObject {
    @Published private(set) var destinations: [MidiDestination] = []

    private var client = MIDIClientRef()
    private var outputPort = MIDIPortRef()

    /// Akkor hívódik, amikor a csatlakoztatott eszközök listája megváltozik.
    var onDestinationsChanged: (([MidiDestination]) -> Void)?

    init() {
        createClient()
    }

    deinit {
        if outputPort != 0 { MIDIPortDispose(outputPort) }
        if client != 0 { MIDIClientDispose(client) }
    }

    private func createClient() {
        var status = MIDIClientCreateWithBlock("ToneXController" as CFString, &client) { [weak self] notification in
            guard notification.pointee.messageID == .msgSetupChanged else { return }
            DispatchQueue.main.async { self?.refresh() }
        }

        guard status == noErr else {
            NSLog("CoreMIDI kliens hiba: %d", status)
            return
        }

        status = MIDIOutputPortCreate(client, "ToneX out" as CFString, &outputPort)
        if status != noErr { NSLog("CoreMIDI kimenet hiba: %d", status) }

        refresh()
    }

    /// Újraolvassa a csatlakoztatott MIDI-kimeneteket, és változás esetén szól a felületnek.
    func refresh() {
        var found: [MidiDestination] = []
        let count = MIDIGetNumberOfDestinations()

        for index in 0..<count {
            let endpoint = MIDIGetDestination(index)
            var uniqueID: Int32 = 0
            MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &uniqueID)
            found.append(MidiDestination(
                id: uniqueID,
                name: Self.stringProperty(endpoint, kMIDIPropertyDisplayName) ?? "MIDI eszköz",
                manufacturer: Self.stringProperty(endpoint, kMIDIPropertyManufacturer) ?? ""
            ))
        }

        guard found != destinations else { return }
        destinations = found
        onDestinationsChanged?(found)
    }

    /// Nyers MIDI bájtok küldése a megadott végpontnak (a böngészőből jövő CC/PC üzenetek).
    func send(_ bytes: [UInt8], to uniqueID: Int32) {
        guard !bytes.isEmpty, let endpoint = endpoint(for: uniqueID), outputPort != 0 else { return }

        var packetList = MIDIPacketList()
        let capacity = MemoryLayout<MIDIPacketList>.size

        withUnsafeMutablePointer(to: &packetList) { listPointer in
            let packet = MIDIPacketListInit(listPointer)
            let added = bytes.withUnsafeBufferPointer { buffer -> UnsafeMutablePointer<MIDIPacket>? in
                MIDIPacketListAdd(listPointer, capacity, packet, 0, buffer.count, buffer.baseAddress!)
            }
            guard added != nil else { return }
            MIDISend(outputPort, endpoint, listPointer)
        }
    }

    private func endpoint(for uniqueID: Int32) -> MIDIEndpointRef? {
        for index in 0..<MIDIGetNumberOfDestinations() {
            let endpoint = MIDIGetDestination(index)
            var candidate: Int32 = 0
            MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &candidate)
            if candidate == uniqueID { return endpoint }
        }
        return nil
    }

    private static func stringProperty(_ object: MIDIObjectRef, _ key: CFString) -> String? {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(object, key, &value) == noErr, let value = value else { return nil }
        return value.takeRetainedValue() as String
    }
}
