// VibeMeshAR — native shell: ARKit TrueDepth face capture feeding the
// VibeMesh Tesserae web app through a WKWebView bridge.
//
// The web page stays the renderer + protocol layer; this shell only
// replaces the capture layer (MediaPipe) with ARKit's 52 blendshapes
// and depth-measured head pose. See ios/README.md for setup.

import SwiftUI
import WebKit

@main
struct VibeMeshARApp: App {
    var body: some Scene {
        WindowGroup { ContentView().ignoresSafeArea() }
    }
}

struct ContentView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.load(URLRequest(url: URL(string: "https://barnickelus.github.io/Vibemesh/tesserae.html")!))
        context.coordinator.attach(web: web)
        return web
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    func makeCoordinator() -> FaceBridge { FaceBridge() }
}
