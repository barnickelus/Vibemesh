# VibeMesh × GNM Pipeline

Ship Google's parametric head model into a browser. Two-stage:
**offline** (Python, one-time) exports a trimmed model + landmark map,
**online** (browser) fits MediaPipe landmarks to GNM coefficients per frame and renders.

## Architecture

```
┌──────────── OFFLINE (one-time) ────────────┐
│  gnm.npz (Google)                          │
│      │                                     │
│      ▼                                     │
│  1_export.py   trim + decimate + pack      │
│      │                                     │
│      ▼                                     │
│  vibemesh_gnm.bin  (~2 MB, ships with app) │
└────────────────────────────────────────────┘
                    │
                    ▼  fetch() on load
┌──────────── ONLINE (per session) ──────────┐
│  Load basis into GPU textures              │
│                                            │
│  Every frame:                              │
│    MediaPipe → 468 landmarks               │
│         │                                  │
│         ▼                                  │
│    fit_coeffs(landmarks)                   │
│      linear least-squares in expression    │
│      + Kabsch for rigid pose               │
│         │                                  │
│         ▼                                  │
│    ~40 expr coeffs + 6 pose params         │
│         │                                  │
│         ▼                                  │
│    GPU vertex shader:                      │
│      v_out = template + id·id_basis        │
│            + expr·expr_basis               │
│            + rigid_transform               │
│         │                                  │
│         ▼                                  │
│    Close Grid / Knots / Filter shaders     │
│    (unchanged — they render on the mesh)   │
└────────────────────────────────────────────┘
```

## What changes vs. current VibeMesh

Nothing about the visual modes changes. The Close Grid, Knots, Splat, Skin
shaders all keep working — they just render on a *real head mesh* instead of a
landmark point cloud. Every calibration bug we've fought disappears because
the mesh has correct anatomy by construction.

## Files
- `1_export_gnm.py` — offline: read gnm.npz, trim, decimate, pack to binary
- `2_landmark_map.py` — offline: precompute MediaPipe landmark → GNM vertex map
- `vibemesh_gnm.js` — online: fitting math + Three.js mesh builder
- `integration.md` — how to wire into current index.html
