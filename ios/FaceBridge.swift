// FaceBridge — runs an ARKit face-tracking session and streams pose +
// blendshapes into the web app via window.VMNative.frame(...).
//
// ARKit gives us, per frame, from the TrueDepth sensor:
//   - a precise head transform (real depth, no calibration ritual)
//   - 52 blendshape coefficients; we map onto VibeMesh's 8-key set
//   - lookAtPoint for gaze
// The wire protocol on the web side is unchanged: still ~23 B packets.

import ARKit
import WebKit

final class FaceBridge: NSObject, ARSessionDelegate {
    private let session = ARSession()
    private weak var web: WKWebView?
    private var frameCount = 0

    func attach(web: WKWebView) {
        self.web = web
        guard ARFaceTrackingConfiguration.isSupported else {
            print("VibeMeshAR: no TrueDepth on this device — web capture only")
            return
        }
        session.delegate = self
        let cfg = ARFaceTrackingConfiguration()
        cfg.isLightEstimationEnabled = true
        session.run(cfg, options: [.resetTracking, .removeExistingAnchors])
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first,
              face.isTracked else { return }
        frameCount += 1
        if frameCount % 2 != 0 { return }          // ~30 Hz is plenty

        // ── head pose → degrees, matching the web app's conventions ──
        // (selfie-mirrored yaw/roll; chin-up = positive pitch).
        // If a rotation reads mirrored on your device, flip the marked sign.
        let m = face.transform
        let pitch =  asin(-m.columns.2.y)
        let yaw   =  atan2(m.columns.2.x, m.columns.2.z)
        let roll  =  atan2(m.columns.0.y, m.columns.1.y)
        let deg: Float = 180 / .pi
        let yawD   = -yaw  * deg      // ← flip here if left/right mirrored
        let pitchD =  pitch * deg     // ← flip here if up/down mirrored
        let rollD  = -roll * deg

        // ── 52 ARKit blendshapes → VibeMesh's 8 keys ──
        // Note the L/R swap: the avatar is a mirror, like a selfie.
        let b = face.blendShapes
        func v(_ k: ARFaceAnchor.BlendShapeLocation) -> Float { b[k]?.floatValue ?? 0 }
        let bs: [String: Float] = [
            "jawOpen":  v(.jawOpen),
            "smile":    (v(.mouthSmileLeft) + v(.mouthSmileRight)) / 2,
            "frown":    (v(.mouthFrownLeft) + v(.mouthFrownRight)) / 2,
            "browUp":   v(.browInnerUp),
            "browDown": (v(.browDownLeft) + v(.browDownRight)) / 2,
            "blinkL":   v(.eyeBlinkRight),
            "blinkR":   v(.eyeBlinkLeft),
            "pucker":   v(.mouthPucker),
        ]
        let gazeX = -face.lookAtPoint.x * 2.5
        let gazeY = -face.lookAtPoint.y * 2.5

        let bsJSON = bs.map { "\($0.key):\(String(format: "%.3f", $0.value))" }
                       .joined(separator: ",")
        let js = "window.VMNative&&VMNative.frame({" +
                 "yaw:\(String(format: "%.2f", yawD))," +
                 "pitch:\(String(format: "%.2f", pitchD))," +
                 "roll:\(String(format: "%.2f", rollD))," +
                 "gazeX:\(String(format: "%.3f", gazeX))," +
                 "gazeY:\(String(format: "%.3f", gazeY))," +
                 "bs:{\(bsJSON)}})"
        DispatchQueue.main.async { [weak self] in
            self?.web?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
