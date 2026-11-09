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
(bone structure, fat compartments, fascia creases; clean topology, true
eye/mouth apertures), **rigged** with a skeleton (root/neck/head/jaw/eyes)
plus 8 generated blendshapes, and **puppeted** from ~23-byte AvatarState
packets.

Likeness is a **closed-loop parameter search**, not a warp. The guided
calibrator (turn left/right/up/down) builds a multi-view landmark cloud;
lens/perspective distortion is solved out by minimising cross-view
disagreement; 17 named measurements (nose length, eye gap, jaw width,
chin projection, cheek prominence…) are then read off both the cloud and
the live model with the *same* functions, and each parameter is moved by
numeric slope until the model's measurement matches yours. Every value
stays inside a clamped human range, so Refine converges instead of
falling apart. Ground-truth recovery test: 0.17 mm mean residual.

The **base head is measured against adult anthropometric norms**
(`test/anthropometry.js`, run it — it fails the build on drift). It used
to fail 12 of 14: temples and cranium far too wide, jaw 16% narrow,
mouth 25% narrow, an over-long nose and a compressed lower third. That
is a cone, which is the alien/doll read, and no amount of skin shading
survives it. Every fitted face is a perturbation of this base, so the
base being wrong was a ceiling on all of them. Now 0 of 14.

**The voice puppets the face.** Three band-split onset detectors watch
the mic — a fast envelope pulling away from a slow one by more than a
dB threshold — and route hits to 21 named anatomical channels (`jaw`,
`mouthKiss`, `browRDown`, `eyeLSquint`…). Channels are selective within
their band, responding to a slice of its spectral centroid, so a vowel
lights different channels than a sibilant and the face staggers instead
of pulsing as one lump. The 21 fold down into the 8 blendshapes that
cross the wire, so it costs **zero extra bytes** — and with no camera it
drives the face on its own.

`CHANNELS` draws the readout: a dot per channel at its own landmark,
sized by how hard it is firing, back-face culled so it sits on the skin;
and the named strip beside it, `*` marking the eight that actually
leave the device. It is the honest picture of what VibeMesh transmits —
a dozen scalars doing the work of a video stream.

**Look:** a `SONDER` post-process replaces the plastic shaded-solid
reading — macroblock tearing, per-channel chromatic split, particle
dissolution off the figure's own edges, feedback trails, and a hue
recolorisation (deep blue → magenta → orange). Its intensity is driven
by the semantic signals the protocol already sends, so the figure comes
apart when you speak, move or gesture and re-coheres when you are still.
Costs nothing on the wire. Toggle `SOLID` to see the shaded surface.
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
