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

### Tesserae renderer (live demo)

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
