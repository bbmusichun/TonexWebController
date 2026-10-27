import SwiftUI
import WebKit

/// A natív app: felül egy vékony állapotsáv (CoreMIDI állapot + frissítés),
/// alatta a változatlan webes felület egy WKWebView-ban.
///
/// A webes felület a bundle-be build időben másolt `Web/` mappából töltődik
/// (lásd az Xcode projekt "Copy web app" build script fázisát), és a
/// `native-midi.js` shim köti össze a Swift oldali CoreMIDI-vel.
struct ControllerView: View {
    @StateObject private var midi = TonexMIDI()
    @State private var reloadToken = 0

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            WebControllerView(midi: midi, reloadToken: reloadToken)
        }
        .background(Color(red: 0.145, green: 0.145, blue: 0.145))
        .preferredColorScheme(.dark)
    }

    private var statusBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(midi.destinations.isEmpty ? Color.orange : Color.green)
                .frame(width: 8, height: 8)

            Text(statusText)
                .font(.footnote)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer(minLength: 8)

            Button {
                midi.refresh()
                reloadToken += 1
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.footnote.weight(.semibold))
            }
            .accessibilityLabel("MIDI-eszközök frissítése")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(red: 0.10, green: 0.10, blue: 0.10))
    }

    private var statusText: String {
        guard let first = midi.destinations.first else {
            return "Nincs USB-MIDI pedál — dugd be a kábelt, majd frissíts"
        }
        return first.name
    }
}

private struct WebControllerView: UIViewRepresentable {
    let midi: TonexMIDI
    let reloadToken: Int

    func makeCoordinator() -> Coordinator {
        Coordinator(midi: midi)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: Coordinator.handlerName)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        context.coordinator.webView = webView
        context.coordinator.loadWebApp(into: webView, token: reloadToken)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedToken != reloadToken else { return }
        context.coordinator.loadWebApp(into: webView, token: reloadToken)
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        static let handlerName = "tonexMIDI"

        private let midi: TonexMIDI
        private(set) var loadedToken = -1
        weak var webView: WKWebView?

        init(midi: TonexMIDI) {
            self.midi = midi
            super.init()
            midi.onDestinationsChanged = { [weak self] _ in
                self?.pushDevices()
            }
        }

        /// A webes felület betöltése a bundle `Web/` mappájából.
        func loadWebApp(into webView: WKWebView, token: Int) {
            loadedToken = token

            guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
                webView.loadHTMLString(
                    "<h1>A webes felület nem található</h1>"
                        + "<p>Futtasd újra a build-et: a Web mappa a build script fázisból kerül az app bundle-be.</p>",
                    baseURL: nil
                )
                return
            }

            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            pushDevices()
        }

        // A native-midi.js üzenetei: { id, action: "list" | "send", ... }
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }

            switch action {
            case "list":
                // A válaszhoz tartozik egy id, amit a native-midi.js vár.
                guard let requestID = body["id"] as? NSNumber else { return }
                midi.refresh()
                evaluate("window.tonexNative && window.tonexNative._resolve(\(requestID.intValue), true, \(devicesJSON()));")
            case "send":
                let target = (body["target"] as? NSNumber)?.int32Value ?? 0
                let bytes = (body["bytes"] as? [NSNumber])?.map { UInt8(truncatingIfNeeded: $0.intValue) } ?? []
                midi.send(bytes, to: target)
            default:
                break
            }
        }

        private func pushDevices() {
            evaluate("window.tonexNative && window.tonexNative._devicesChanged(\(devicesJSON()));")
        }

        private func devicesJSON() -> String {
            let items = midi.destinations.map { destination in
                "{\"id\":\(destination.id),"
                    + "\"name\":\(Self.jsonString(destination.name)),"
                    + "\"manufacturer\":\(Self.jsonString(destination.manufacturer))}"
            }
            return "[\(items.joined(separator: ","))]"
        }

        private func evaluate(_ script: String) {
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private static func jsonString(_ value: String) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: [value]),
                  let array = String(data: data, encoding: .utf8) else { return "\"\"" }
            return String(array.dropFirst().dropLast())
        }
    }
}
