"""
VibeMesh × GNM — Landmark Correspondence
=========================================

Computes the mapping from MediaPipe's 468 face landmarks to GNM mesh vertices,
and writes it into the tail of vibemesh_gnm.bin.

Why this exists: per-frame fitting solves
    argmin_c  Σ_i || gnm_vertex(lm_map[i], c) - mediapipe_landmark[i] ||²
so we need to know, for each MediaPipe landmark index, which GNM vertex is
the same anatomical point.

Strategy (automatic, no manual clicking):
1. MediaPipe's canonical face model is published as a 3D mesh
   (canonical_face_model.obj in the mediapipe repo — 468 vertices in
   canonical pose, units of cm).
2. Rigidly align (scale + rotation + translation) the canonical MediaPipe
   mesh to the GNM template using Procrustes on both meshes' bounding
   structure, then refine with ICP.
3. For each of the 468 aligned MediaPipe points, take the nearest GNM
   template vertex. That's the correspondence.

The alignment doesn't need to be perfect — a few mm of slop is fine because
the fit is least-squares over many points.

Usage:
    # canonical_face_model.obj from:
    # https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
    python 2_landmark_map.py vibemesh_gnm.bin --canonical canonical_face_model.obj
"""

import argparse
import struct
import sys
from pathlib import Path

import numpy as np

MAGIC = b"VMGM"


def read_header(f):
    magic = f.read(4)
    assert magic == MAGIC, f"bad magic {magic}"
    version, V, F, K_id, K_ex = struct.unpack("<5I", f.read(20))
    return version, V, F, K_id, K_ex


def read_template(path):
    with open(path, "rb") as f:
        version, V, F, K_id, K_ex = read_header(f)
        template = np.frombuffer(f.read(V * 3 * 2), dtype=np.float16).astype(
            np.float32
        ).reshape(V, 3)
    return template, (version, V, F, K_id, K_ex)


def landmark_map_offset(V, F, K_id, K_ex):
    """Byte offset of the lm_map block in the bin file."""
    return (
        4 + 20                       # magic + header
        + V * 3 * 2                  # template fp16
        + F * 3 * 4                  # faces u32
        + K_id * V * 3 * 2           # id basis fp16
        + K_ex * V * 3 * 2           # expr basis fp16
        + V * 2 * 2                  # uv fp16
    )


def load_obj_vertices(path):
    verts = []
    for line in open(path):
        if line.startswith("v "):
            _, x, y, z = line.split()[:4]
            verts.append([float(x), float(y), float(z)])
    return np.array(verts, dtype=np.float32)


def procrustes_align(src, dst):
    """
    Similarity transform (scale s, rotation R, translation t) mapping src→dst,
    least squares over corresponding "structural" points. Since the two meshes
    don't share topology, we align on robust structural statistics instead of
    point pairs: centroid + principal axes + scale from axis spreads.
    Then ICP refines.
    """
    def frame(pts):
        c = pts.mean(axis=0)
        X = pts - c
        # principal axes
        _, _, Vt = np.linalg.svd(X, full_matrices=False)
        # consistent handedness
        if np.linalg.det(Vt) < 0:
            Vt[2] *= -1
        spread = np.sqrt((X @ Vt.T).var(axis=0))
        return c, Vt, spread

    c_s, R_s, sp_s = frame(src)
    c_d, R_d, sp_d = frame(dst)

    scale = float(np.median(sp_d / np.maximum(sp_s, 1e-9)))
    R = R_d.T @ R_s          # rotate src frame into dst frame
    t = c_d - scale * (c_s @ R.T)
    return scale, R, t


def apply_sim(pts, s, R, t):
    return s * (pts @ R.T) + t


def icp_refine(src, dst, s, R, t, iters=30):
    """Point-to-point ICP with nearest neighbors from scipy KDTree."""
    from scipy.spatial import cKDTree

    tree = cKDTree(dst)
    cur = apply_sim(src, s, R, t)
    for _ in range(iters):
        d, idx = tree.query(cur)
        # reject worst 20% as outliers (hair region etc.)
        keep = d < np.percentile(d, 80)
        A = src[keep]
        B = dst[idx[keep]]
        # solve similarity transform A→B (Umeyama)
        ca, cb = A.mean(0), B.mean(0)
        A0, B0 = A - ca, B - cb
        U, S, Vt = np.linalg.svd(A0.T @ B0)
        D = np.eye(3)
        if np.linalg.det(U @ Vt) < 0:
            D[2, 2] = -1
        R = (U @ D @ Vt).T
        s = np.trace(np.diag(S) @ D) / (A0 ** 2).sum()
        t = cb - s * (ca @ R.T)
        cur = apply_sim(src, s, R, t)
    return s, R, t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bin", type=Path)
    ap.add_argument("--canonical", type=Path, required=True,
                    help="mediapipe canonical_face_model.obj (468 verts)")
    args = ap.parse_args()

    print("Reading GNM template from bin…")
    gnm_template, (version, V, F, K_id, K_ex) = read_template(args.bin)

    print("Reading MediaPipe canonical face model…")
    mp_canon = load_obj_vertices(args.canonical)
    assert mp_canon.shape[0] == 468, f"expected 468 verts, got {mp_canon.shape[0]}"

    print("Coarse Procrustes alignment…")
    s, R, t = procrustes_align(mp_canon, gnm_template)

    print("ICP refinement…")
    s, R, t = icp_refine(mp_canon, gnm_template, s, R, t)
    aligned = apply_sim(mp_canon, s, R, t)

    print("Nearest-vertex correspondence…")
    from scipy.spatial import cKDTree
    tree = cKDTree(gnm_template)
    dist, lm_map = tree.query(aligned)
    lm_map = lm_map.astype(np.int32)

    med = np.median(dist)
    print(f"  median snap distance: {med:.4f} model units")
    # Reject landmarks that landed far from any surface (e.g. iris refinement
    # points if you exported with refine_landmarks). Mark unmapped as -1.
    bad = dist > 4 * med
    lm_map[bad] = -1
    print(f"  mapped {int((~bad).sum())}/468 landmarks ({int(bad.sum())} rejected)")

    print("Writing lm_map into bin tail…")
    off = landmark_map_offset(V, F, K_id, K_ex)
    with open(args.bin, "r+b") as f:
        f.seek(off)
        f.write(lm_map.tobytes())

    print("✓ done. vibemesh_gnm.bin is complete and ready to ship.")


if __name__ == "__main__":
    main()
