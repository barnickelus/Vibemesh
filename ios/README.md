# VibeMeshAR — native iOS shell (ARKit capture → web renderer)

The hybrid step toward photoreal likeness: ARKit's TrueDepth face
tracking (1,220-vertex depth-measured mesh, 52 blendshapes, precise
head pose) replaces MediaPipe as the capture layer, while the whole
VibeMesh protocol + Tesserae renderer keeps running unchanged in a
WKWebView. Wire cost stays ~23 bytes/packet.

## Requirements
- Mac with Xcode 15+
- iPhone X or later / any Face ID or LiDAR iPad (TrueDepth required)
- Apple developer account (free tier works for on-device testing)

## Setup (~5 minutes)
1. Xcode → New Project → iOS App. Name: `VibeMeshAR`, interface
   SwiftUI, language Swift.
2. Delete the generated `ContentView.swift`/`<App>.swift`; drag
   `VibeMeshARApp.swift` and `FaceBridge.swift` from this folder in.
3. Target → Info tab, add:
   - `NSCameraUsageDescription` → "Face tracking drives your avatar."
4. Target → General: iOS 16.0 minimum. Signing: your team.
5. Run on a real device (simulator has no TrueDepth).

## What it does
- Loads https://barnickelus.github.io/Vibemesh/tesserae.html
- Streams pose + blendshapes at ~30 Hz into `window.VMNative.frame()`
- The web app skips MediaPipe and the guided calibrator entirely —
  ARKit's pose is depth-measured, no turns needed
- Don't tap "Init Optics" in the shell; capture is already running

## Axis signs
Head-pose sign conventions vary by device orientation. If a rotation
mirrors, flip the marked signs in `FaceBridge.swift` (`yawD`/`pitchD`).

## Next steps (in order)
1. Ship identity from ARKit geometry: `face.geometry.vertices`
   (1,220 verts) → downsample → `VMNative.identity({lm, lmCol, ...})`
   for a depth-true likeness scan instead of the RGB estimate.
2. Sample face texture from the camera frame per vertex for photo
   tiles at scan accuracy.
3. Replace BroadcastChannel with a real transport (WebRTC data
   channel or MultipeerConnectivity bridged the same way).
