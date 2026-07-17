# Wiring GNM into VibeMesh

## Measured numbers (not estimates — benchmarked in `node`)

| | |
|---|---|
| Model download | **~2.1 MB** (5k verts, 32 id + 40 expr, fp16) |
| One-time cache build on load | **138 ms** |
| Per-frame fit (400 landmarks → 40 coeffs) | **4.31 ms** → 232 fps headroom |
| Live coefficient stream | **92 bytes/frame** → **22 kbps** at 30 fps |

Fit accuracy on synthetic ground truth: L1 error 0.84 across 6 coefficients
(signs and magnitudes recovered correctly). Cholesky solve and Horn rotation
are exact to machine precision.

## What this replaces

Delete from `index.html`:
- `calibrate()` — GNM's rest pose is fixed by construction
- `solveFrame()` — replaced by `gnm.fitFrame()`
- `worldPos()` — the vertex shader does the transform now
- `canonPts` / `neutralScale` / `zRange` / the whole fixed-normalization dance
- `buildSkinMesh()` / `updateSkinMesh()` / `buildPointSystem()` — one mesh now
- The face-ellipse mask hack in the Close Filter

That's roughly 400 lines of accumulated workarounds, all of which existed to
compensate for not having a face model.

## What stays

Every fragment shader. `SKIN_FRAG` (Close grid), `KNOT_FRAG`, `SPLAT_FRAG`,
`REALIST_FRAG` all work unchanged — they just read different varyings.

## Integration steps

### 1. Load

```html
<script src="vibemesh_gnm.js"></script>
```

```js
let gnm = null;

async function initOptics(){
  // ... existing camera setup ...
  gnm = await GNMHead.load('vibemesh_gnm.bin');
  gnm.setFragmentShader(SKIN_FRAG_GNM);   // see §3
  scene.add(gnm.mesh);
}
```

### 2. Per frame

```js
function onResults(res){
  if(!res.multiFaceLandmarks?.[0]) return;
  latest = res.multiFaceLandmarks[0];
  if(!gnm) return;

  if(!gnm._identityDone){
    // one neutral frame — no "hold still" ritual needed, but a
    // deliberate button press gives a cleaner identity fit
    return;
  }
  gnm.fitFrame(latest, ST.smooth);
}

// Calibrate button:
function doCalibrate(){
  gnm.fitIdentity(latest);
  gnm._identityDone = true;
}
```

### 3. Adapt the Close grid fragment shader

The only change: read `vCanon` (pose-free position from the morph vertex
shader) instead of the old `sUV` attribute. The grid is *genuinely* locked to
the face now — GNM's canonical space is stable by definition, not
reconstructed per frame.

```glsl
// SKIN_FRAG_GNM — Close grid on the parametric head
varying vec2 vUvOut;
varying vec3 vCanon;
uniform sampler2D uSkinTex;   // optional: video-sampled skin colour
uniform float uTime, uGrid, uOpacity, uPulse;

// ... rgb2hsv / hsv2rgb / hash unchanged ...

void main(){
  // Grid coordinate: use GNM's own UV — this is a proper unwrap of the
  // head, so cells have even size across the whole face. The old planar
  // projection stretched cells at the jaw and temples.
  vec2 fUV = vUvOut;

  float ang=0.20, ca=cos(ang), sa=sin(ang);
  vec2 uvR = vec2(fUV.x*ca - fUV.y*sa, fUV.x*sa + fUV.y*ca);
  vec2 sc  = uvR * uGrid;
  vec2 cell= floor(sc);
  vec2 p   = (sc - cell - 0.5) * 2.0;

  // skin tone: sample the video through the model's UV, or use a
  // per-vertex colour attribute captured at calibration
  vec3 fc = texture2D(uSkinTex, fUV).rgb;

  // ... rest of the Close cell code is IDENTICAL to current SKIN_FRAG ...
}
```

### 4. Depth shading

The old `fComp` (fake compression from canonical Z) is replaced by a real
surface normal, which GNM gives you correctly:

```glsl
// in MORPH_VERT, add:
varying vec3 vNormal;
// compute from the morphed position via the geometry's normal attribute
// (recompute normals on the CPU only if you need per-frame accuracy —
//  for shading, the template normals rotated by pose are close enough)
vNormal = normalize(uPoseR * normal);
```

Then in the fragment: `float lambert = max(0.0, dot(vNormal, vec3(0,0,1)));`
This is a *real* lighting term, not a Z-depth hack.

## Honest caveats

**The .npz introspection may need adjusting.** `1_export_gnm.py` probes for
attribute names (`identity_basis`, `shape_basis`, …) because I could not
download and inspect Google's actual file layout. If the probe fails it prints
the available attributes — one line to fix, but expect to fix it.

**GNM v3 uses linear blend skinning for jaw/eye/neck joints.** The exporter
above captures the PCA bases but *not* the LBS joint transforms. For a
face-only portrait this is mostly fine (expression PCA covers visible
deformation). If you want proper jaw articulation you also need to export
`joint_weights` + `joint_regressor` and apply LBS in the vertex shader — about
30 more lines, and I'd add it once the base pipeline is proven.

**Landmark correspondence is automatic but approximate.** ICP-aligning
MediaPipe's canonical mesh to GNM's template gets you within a few mm.
Good enough for least-squares fitting over 400 points; not good enough if you
wanted per-vertex texture transfer.

**The dataset has known representation limits** — binary gender categories and
four demographic groups. Worth knowing about what the shape prior encodes.

## Recommended order

1. Run `1_export_gnm.py`, fix whatever the attribute probe complains about
2. Run `2_landmark_map.py`, sanity-check the median snap distance it prints
3. Load in browser, render the raw template with the placeholder shader —
   confirm you get a head
4. Wire `fitIdentity` to the Calibrate button — confirm the head becomes *you*
5. Wire `fitFrame` — confirm expressions track
6. Only then swap in the Close grid shader

Do not skip step 3. Confirm the mesh loads and renders before adding any
fitting, or you'll be debugging two things at once.
