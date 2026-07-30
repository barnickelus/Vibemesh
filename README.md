# 🏖️ VibeMesh v1.4 — Low-Bit Avatar System (Shore Edition)

The future of human connection. No raw video. Just pure semantic vibes.

Works on 2G, low battery, potato phones. Cross-platform (WebGL + Unity + Unreal ready).

### Quick Start (2 tabs demo)
1. `npm install && npm run dev`
2. Open two tabs
3. Follow console instructions for WebRTC handshake
4. Slide bandwidth down and watch tiers drop live
5. Send fist pumps and see the other tab react

Built with love in Vancouver + Jersey Shore energy.

### VibeMesh (current build)

`vibemesh.html` is the ground-up rebuild: a **self-generating parametric
human** — a real polygon head sculpted from anatomical feature fields
(clean topology, true eye/mouth apertures), **rigged** with a skeleton
(root/neck/head/jaw/eyes) plus 8 generated blendshapes, and **puppeted**
from ~23-byte AvatarState packets. Likeness is earned in two stages:
measured ratios reshape the generator, then a gaussian RBF warp
interpolates the base onto your measured landmark cloud — smooth by
construction, so Refine converges instead of falling apart.
Live: https://barnickelus.github.io/Vibemesh/vibemesh.html

### Tesserae renderer (earlier voxel-mosaic build)

`tesserae.html` is the ground-up VibeMesh build: deterministic tier
negotiation (TEXT → GLYPH → SPRITE → PUPPET → AVATAR3D), ~10–23 byte
binary AvatarState packets, MediaPipe face capture, and the Tesserae
voxel-mosaic 3D avatar with adaptive detail and style palettes. Open
it in two tabs and they pair peer-to-peer over BroadcastChannel.
Live: https://barnickelus.github.io/Vibemesh/tesserae.html

### GNM head-model pipeline (in progress)

`gnm/` holds the offline export + online runtime for swapping the live
landmark-cloud rendering in `index.html` for Google's parametric GNM head
model — real anatomy by construction instead of per-frame calibration
hacks. See `gnm/README.md` for the architecture and `gnm/integration.md`
for wiring steps.
