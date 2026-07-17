"""
VibeMesh × GNM — Offline Export
================================

Trims Google's GNM Head model down to a browser-shippable binary.

Reduces:
- 253 identity components → top 32 (covers most between-subject variance)
- 383 expression components → top 40 (jaw/eyes/mouth/brows — the visible stuff)
- Full head mesh → decimated to ~5000 vertices (still smooth for face rendering)

Output layout is versioned so the JS loader can validate on fetch.

Prereq (do once):
    mamba create -n gnm python=3.13 && mamba activate gnm
    git clone https://github.com/google/GNM
    cd GNM/gnm/shape && pip install -e .

Then in this dir:
    python 1_export_gnm.py --keep-id 32 --keep-expr 40 --target-verts 5000
"""

import argparse
import struct
import sys
from pathlib import Path

import numpy as np


# ── Header format for vibemesh_gnm.bin ──────────────────────────────
# All little-endian. Floats stored as float16 to halve size.
#
#   magic          4 bytes   "VMGM"
#   version        u32       1
#   n_verts        u32       V
#   n_faces        u32       F
#   n_id           u32       K_id
#   n_expr         u32       K_expr
#   template       V*3 * fp16   mean face vertex positions
#   faces          F*3 * u32    triangle indices
#   id_basis       V*3 * K_id * fp16    identity PCA basis (row-major per vertex)
#   expr_basis     V*3 * K_expr * fp16  expression blendshapes
#   uv             V*2 * fp16          texture coordinates
#   lm_map         468 * u32           MediaPipe landmark → GNM vertex index
#                                      (filled in by 2_landmark_map.py; -1 if unmapped)
#
# The JS loader can seek by header offsets — no JSON, no zlib, no dependencies.

MAGIC = b"VMGM"
VERSION = 1


def load_gnm_model():
    """
    Load Google's GNM Head model. Introspect its arrays so we don't hard-code
    field names — Google may reshape between v3.x releases.
    """
    from gnm.shape import gnm_numpy

    model = gnm_numpy.GNM.from_local(
        version=gnm_numpy.GNMMajorVersion.V3,
        variant=gnm_numpy.GNMVariant.HEAD,
    )

    template = np.asarray(model.template_vertex_positions, dtype=np.float32)
    faces = np.asarray(model.triangles, dtype=np.int32)

    # The identity & expression bases are exposed as callables in the public
    # API (you get a mesh out by passing coefficients). To grab the raw bases
    # we probe common attribute names — GNM stores them as PCA components.
    # If any of these fail on your version, print(dir(model)) to inspect.
    def probe(*names, required=True):
        for n in names:
            if hasattr(model, n):
                arr = getattr(model, n)
                if callable(arr):
                    continue
                return np.asarray(arr, dtype=np.float32)
        if required:
            raise RuntimeError(
                f"Could not find any of {names} on GNM model. "
                f"Available attrs: {[a for a in dir(model) if not a.startswith('_')]}"
            )
        return None

    # Bases are shape (K, V*3) or (K, V, 3). We normalize to (V*3, K) after.
    id_basis = probe("identity_basis", "id_basis", "shape_basis", "identity_components")
    ex_basis = probe("expression_basis", "expr_basis", "blendshapes", "expression_components")
    uv = probe("uv", "uv_coordinates", "texture_coordinates", required=False)

    # Reshape bases to (V, 3, K) → (V*3, K) column-major so each column is
    # a "delta mesh" you add scaled by one coefficient.
    def normalize_basis(b, V):
        if b.ndim == 3 and b.shape[1] == V and b.shape[2] == 3:
            # (K, V, 3) → (V*3, K)
            return b.transpose(1, 2, 0).reshape(V * 3, -1)
        if b.ndim == 3 and b.shape[0] == V and b.shape[1] == 3:
            # (V, 3, K)
            return b.reshape(V * 3, -1)
        if b.ndim == 2:
            # (K, V*3) or (V*3, K) — orient so second dim is K
            if b.shape[0] == V * 3:
                return b
            if b.shape[1] == V * 3:
                return b.T
        raise ValueError(f"unexpected basis shape {b.shape} for V={V}")

    V = template.shape[0]
    id_basis = normalize_basis(id_basis, V)
    ex_basis = normalize_basis(ex_basis, V)

    if uv is not None and uv.ndim == 2 and uv.shape[0] != V:
        uv = uv.T
    if uv is None:
        # Fall back to a simple planar UV projection so shaders still work.
        # Not ideal but the Close Grid uses face-local coords anyway.
        print("[warn] no UV found on GNM model, using planar projection", file=sys.stderr)
        uv = np.stack(
            [
                (template[:, 0] - template[:, 0].min())
                / max(1e-6, template[:, 0].ptp()),
                (template[:, 1] - template[:, 1].min())
                / max(1e-6, template[:, 1].ptp()),
            ],
            axis=1,
        ).astype(np.float32)

    return template, faces, id_basis, ex_basis, uv


def trim_basis(basis, keep_k):
    """
    Keep top-K principal components. GNM stores basis vectors sorted by
    decreasing variance, so we just slice. If ordering isn't guaranteed on
    your version, compute per-column norms and take argsort.
    """
    K = basis.shape[1]
    if keep_k >= K:
        return basis, np.arange(K)
    # Safety: rank by column magnitude in case they're not pre-sorted.
    norms = np.linalg.norm(basis, axis=0)
    order = np.argsort(-norms)[:keep_k]
    return basis[:, order], order


def decimate(vertices, faces, id_basis, ex_basis, uv, target_verts):
    """
    Simplify the mesh using quadric decimation, preserving:
    - vertex positions
    - both PCA bases (each basis column is a valid mesh, so we decimate them
      together by using the same face collapses)
    - UV coordinates

    Requires: pip install open3d  (or trimesh with fast-simplification).
    """
    if vertices.shape[0] <= target_verts:
        return vertices, faces, id_basis, ex_basis, uv

    try:
        import fast_simplification as fs
    except ImportError:
        print(
            "[warn] fast_simplification not installed. "
            "Run: pip install fast-simplification. Skipping decimation.",
            file=sys.stderr,
        )
        return vertices, faces, id_basis, ex_basis, uv

    target_ratio = 1.0 - (target_verts / vertices.shape[0])
    v_new, f_new, collapses = fs.simplify(
        vertices.astype(np.float32),
        faces.astype(np.uint32),
        target_reduction=target_ratio,
        agg=7,
        return_collapses=True,
    )

    # Replay the same collapses on each basis column (each column is a
    # displacement field per vertex — same topology as vertices).
    def replay(arr_2d):
        V0 = vertices.shape[0]
        K = arr_2d.shape[1]
        # arr_2d shape (V0*3, K). Reshape to (V0, 3, K), apply per-column,
        # then flatten. fast_simplification exposes a helper for this via
        # `replay_simplification`.
        arr_v = arr_2d.reshape(V0, 3, K)
        out = np.zeros((v_new.shape[0], 3, K), dtype=np.float32)
        for k in range(K):
            out[:, :, k] = fs.replay_simplification(
                arr_v[:, :, k], collapses
            )
        return out.reshape(-1, K)

    id_new = replay(id_basis)
    ex_new = replay(ex_basis)

    # UV: same pattern but 2 channels.
    uv_v = uv.reshape(vertices.shape[0], 2, 1)
    uv_new = fs.replay_simplification(uv_v[:, :, 0], collapses)

    return v_new, f_new.astype(np.int32), id_new, ex_new, uv_new


def to_fp16(arr):
    return arr.astype(np.float16).tobytes()


def write_bin(path, template, faces, id_basis, ex_basis, uv):
    V = template.shape[0]
    F = faces.shape[0]
    K_id = id_basis.shape[1]
    K_ex = ex_basis.shape[1]

    with open(path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", VERSION))
        f.write(struct.pack("<I", V))
        f.write(struct.pack("<I", F))
        f.write(struct.pack("<I", K_id))
        f.write(struct.pack("<I", K_ex))
        f.write(to_fp16(template))
        f.write(faces.astype(np.uint32).tobytes())
        # bases are stored (V*3, K) — reshape to (V, 3, K) for cleaner GPU upload
        f.write(to_fp16(id_basis.reshape(V, 3, K_id).transpose(2, 0, 1)))
        f.write(to_fp16(ex_basis.reshape(V, 3, K_ex).transpose(2, 0, 1)))
        f.write(to_fp16(uv))
        # Landmark map placeholder — filled by 2_landmark_map.py
        f.write((np.full(468, -1, dtype=np.int32)).tobytes())

    size_mb = path.stat().st_size / 1024 / 1024
    print(f"✓ wrote {path} — {V} verts, {F} faces, "
          f"{K_id} id + {K_ex} expr components, {size_mb:.2f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-id", type=int, default=32,
                    help="top-K identity components to retain (default 32)")
    ap.add_argument("--keep-expr", type=int, default=40,
                    help="top-K expression components (default 40)")
    ap.add_argument("--target-verts", type=int, default=5000,
                    help="decimate mesh to this vertex count (default 5000)")
    ap.add_argument("--out", type=Path, default=Path("vibemesh_gnm.bin"))
    args = ap.parse_args()

    print("Loading GNM model from Google package…")
    template, faces, id_basis, ex_basis, uv = load_gnm_model()
    print(f"  raw: V={template.shape[0]} F={faces.shape[0]} "
          f"id={id_basis.shape[1]} expr={ex_basis.shape[1]}")

    print("Trimming principal components…")
    id_basis, _ = trim_basis(id_basis, args.keep_id)
    ex_basis, _ = trim_basis(ex_basis, args.keep_expr)

    print(f"Decimating to ~{args.target_verts} vertices…")
    template, faces, id_basis, ex_basis, uv = decimate(
        template, faces, id_basis, ex_basis, uv, args.target_verts
    )
    print(f"  decimated: V={template.shape[0]} F={faces.shape[0]}")

    write_bin(args.out, template, faces, id_basis, ex_basis, uv)
    print(f"\nNext: run  python 2_landmark_map.py {args.out}")


if __name__ == "__main__":
    main()
