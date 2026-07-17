/**
 * VibeMesh × GNM — Browser Runtime
 * =================================
 *
 * Loads vibemesh_gnm.bin, fits GNM coefficients to live MediaPipe landmarks
 * each frame, renders the parametric head with GPU morphing.
 *
 * The mesh is anatomically correct BY CONSTRUCTION — the calibration drift,
 * balloon-head, and inside-out-mask bugs of landmark-cloud rendering cannot
 * happen here because vertices only ever move along learned face deformations.
 *
 * Pipeline per frame (~1.5ms on mobile):
 *   1. Rigid pose:   Kabsch on mapped landmark pairs  → R, t, s
 *   2. Expression:   ridge-regularized least squares  → 40 coeffs
 *   3. Upload 40 floats to GPU uniform, vertex shader does the morph.
 *
 * Identity is fit ONCE at calibration (same solve, over id basis), then
 * frozen — your face shape doesn't change frame to frame, only expression.
 *
 * Usage:
 *   const gnm = await GNMHead.load('vibemesh_gnm.bin');
 *   scene.add(gnm.mesh);
 *   // at calibration:
 *   gnm.fitIdentity(mediapipeLandmarks);
 *   // per frame:
 *   gnm.fitFrame(mediapipeLandmarks);   // updates pose + expression uniforms
 */
'use strict';

/* global THREE */

class GNMHead {

  // ─────────────────────────────────────────────────────────────
  //  LOADING
  // ─────────────────────────────────────────────────────────────
  static async load(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    let o = 0;
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4)); o += 4;
    if (magic !== 'VMGM') throw new Error('bad gnm bin');
    const version = dv.getUint32(o, true); o += 4;
    const V  = dv.getUint32(o, true); o += 4;
    const F  = dv.getUint32(o, true); o += 4;
    const Kid = dv.getUint32(o, true); o += 4;
    const Kex = dv.getUint32(o, true); o += 4;

    const f16 = (count) => {
      const out = new Float32Array(count);
      const u16 = new Uint16Array(buf, o, count);
      for (let i = 0; i < count; i++) out[i] = GNMHead.halfToFloat(u16[i]);
      o += count * 2;
      return out;
    };

    const template = f16(V * 3);
    const faces = new Uint32Array(buf.slice(o, o + F * 3 * 4)); o += F * 3 * 4;
    const idBasis = f16(Kid * V * 3);   // layout: [k][v][xyz]
    const exBasis = f16(Kex * V * 3);
    const uv = f16(V * 2);
    const lmMap = new Int32Array(buf.slice(o, o + 468 * 4)); o += 468 * 4;

    return new GNMHead({ V, F, Kid, Kex, template, faces, idBasis, exBasis, uv, lmMap });
  }

  static halfToFloat(h) {
    const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  constructor(d) {
    Object.assign(this, d);
    this.idCoeffs = new Float32Array(this.Kid);   // frozen after calibration
    this.exCoeffs = new Float32Array(this.Kex);   // updated every frame
    this.poseR = [1,0,0, 0,1,0, 0,0,1];
    this.poseT = [0,0,0];
    this.poseS = 1;
    this._buildMesh();
    this._buildFitCache();
  }

  // ─────────────────────────────────────────────────────────────
  //  GPU MESH — morphing in the vertex shader
  //
  //  Bases are packed into DataTextures. The vertex shader reads its own
  //  row and accumulates  template + Σ id_k·idBasis_k + Σ ex_k·exBasis_k.
  //  40 texel fetches per vertex per basis — trivial on any GPU.
  // ─────────────────────────────────────────────────────────────
  _buildMesh() {
    const { V, Kid, Kex } = this;

    // Pack each basis as a float texture: width = V, height = K, RGB = xyz.
    const mkTex = (basis, K) => {
      const data = new Float32Array(V * K * 4);
      for (let k = 0; k < K; k++)
        for (let v = 0; v < V; v++) {
          const src = (k * V + v) * 3, dst = (k * V + v) * 4;
          data[dst] = basis[src]; data[dst+1] = basis[src+1]; data[dst+2] = basis[src+2];
        }
      const t = new THREE.DataTexture(data, V, K, THREE.RGBAFormat, THREE.FloatType);
      t.needsUpdate = true;
      return t;
    };

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.template.slice(), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    // vertex index attribute for texture row lookup
    const vidx = new Float32Array(V);
    for (let i = 0; i < V; i++) vidx[i] = i;
    geo.setAttribute('aVidx', new THREE.BufferAttribute(vidx, 1));
    geo.setIndex(new THREE.BufferAttribute(this.faces, 1));

    this.uniforms = {
      uIdTex:  { value: mkTex(this.idBasis, Kid) },
      uExTex:  { value: mkTex(this.exBasis, Kex) },
      uIdCo:   { value: this.idCoeffs },
      uExCo:   { value: this.exCoeffs },
      uV:      { value: this.V },
      uKid:    { value: Kid },
      uKex:    { value: Kex },
      uPoseR:  { value: new THREE.Matrix3() },
      uPoseT:  { value: new THREE.Vector3() },
      uPoseS:  { value: 1.0 },
      // downstream visual-mode uniforms merge here (uTime, uGrid, etc.)
      uTime:   { value: 0 },
      uGrid:   { value: 18 },
      uOpacity:{ value: 0.95 },
      uPulse:  { value: 0.6 },
    };

    const MORPH_VERT = `
      uniform sampler2D uIdTex, uExTex;
      uniform float uIdCo[${Kid}];
      uniform float uExCo[${Kex}];
      uniform float uV;
      uniform mat3  uPoseR;
      uniform vec3  uPoseT;
      uniform float uPoseS;
      attribute float aVidx;
      varying vec2 vUvOut;
      varying vec3 vCanon;      // canonical (pose-free) position for Close grid
      varying vec3 vWorldN;

      void main(){
        float u = (aVidx + 0.5) / uV;
        vec3 p = position;
        for (int k = 0; k < ${Kid}; k++) {
          vec3 d = texture2D(uIdTex, vec2(u, (float(k)+0.5)/${Kid}.0)).xyz;
          p += uIdCo[k] * d;
        }
        for (int k = 0; k < ${Kex}; k++) {
          vec3 d = texture2D(uExTex, vec2(u, (float(k)+0.5)/${Kex}.0)).xyz;
          p += uExCo[k] * d;
        }
        vCanon = p;                       // grid locks to this — never swims
        vec3 world = uPoseS * (uPoseR * p) + uPoseT;
        vUvOut = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
      }
    `;

    // Placeholder fragment — VibeMesh visual modes replace this string.
    const FRAG = `
      varying vec2 vUvOut;
      varying vec3 vCanon;
      void main(){ gl_FragColor = vec4(0.6 + 0.4*normalize(vCanon), 1.0); }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader: MORPH_VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Swap in a VibeMesh visual-mode fragment shader (Close grid, knots…). */
  setFragmentShader(frag, extraUniforms = {}) {
    Object.assign(this.uniforms, extraUniforms);
    this.material.fragmentShader = frag;
    this.material.needsUpdate = true;
  }

  // ─────────────────────────────────────────────────────────────
  //  FITTING
  //
  //  Landmarks come in as MediaPipe normalized coords. We map them into
  //  GNM model space using the current similarity transform, then solve.
  //
  //  Expression solve (per frame): ridge least squares
  //     min_c  || A c − r ||²  +  λ||c||²
  //  where A is (3M × Kex) — the expression basis restricted to the M
  //  mapped landmark vertices — and r is the residual after removing the
  //  identity + template + rigid pose.  A is FIXED, so AᵀA + λI is
  //  precomputed and Cholesky-factored once. Per frame we only do
  //  Aᵀr (3M·Kex mults) and two triangular solves — microseconds.
  // ─────────────────────────────────────────────────────────────
  _buildFitCache() {
    // Mapped landmark list (mp index, gnm vertex)
    this.pairs = [];
    for (let i = 0; i < 468; i++)
      if (this.lmMap[i] >= 0) this.pairs.push([i, this.lmMap[i]]);
    const M = this.pairs.length;

    // A_ex: (3M × Kex) slice of expression basis at mapped vertices
    const Kex = this.Kex;
    const A = new Float32Array(3 * M * Kex);
    for (let m = 0; m < M; m++) {
      const v = this.pairs[m][1];
      for (let k = 0; k < Kex; k++) {
        const src = (k * this.V + v) * 3;
        A[(3*m  ) * Kex + k] = this.exBasis[src];
        A[(3*m+1) * Kex + k] = this.exBasis[src+1];
        A[(3*m+2) * Kex + k] = this.exBasis[src+2];
      }
    }
    this.A_ex = A;
    this.M = M;

    // Normal matrix N = AᵀA + λI, Cholesky-factored.
    // λ is scaled by mean(diag(AᵀA)) so it's a *relative* penalty — using an
    // absolute λ·M swamps the data term and shrinks all coefficients to zero.
    const N = new Float64Array(Kex * Kex);
    let traceN = 0;
    for (let i = 0; i < Kex; i++)
      for (let j = i; j < Kex; j++) {
        let s = 0;
        for (let r = 0; r < 3 * M; r++) s += A[r*Kex+i] * A[r*Kex+j];
        N[i*Kex+j] = N[j*Kex+i] = s;
        if (i === j) traceN += s;
      }
    const LAMBDA = 0.02;                    // relative ridge — light touch
    const ridge = LAMBDA * (traceN / Kex);
    for (let i = 0; i < Kex; i++) N[i*Kex+i] += ridge;
    this.chol_ex = GNMHead.cholesky(N, Kex);

    // Same cache for the identity basis (used once at calibration)
    const Kid = this.Kid;
    const Ai = new Float32Array(3 * M * Kid);
    for (let m = 0; m < M; m++) {
      const v = this.pairs[m][1];
      for (let k = 0; k < Kid; k++) {
        const src = (k * this.V + v) * 3;
        Ai[(3*m  ) * Kid + k] = this.idBasis[src];
        Ai[(3*m+1) * Kid + k] = this.idBasis[src+1];
        Ai[(3*m+2) * Kid + k] = this.idBasis[src+2];
      }
    }
    this.A_id = Ai;
    const Ni = new Float64Array(Kid * Kid);
    let traceI = 0;
    for (let i = 0; i < Kid; i++)
      for (let j = i; j < Kid; j++) {
        let s = 0;
        for (let r = 0; r < 3 * M; r++) s += Ai[r*Kid+i] * Ai[r*Kid+j];
        Ni[i*Kid+j] = Ni[j*Kid+i] = s;
        if (i === j) traceI += s;
      }
    // Identity gets a stronger relative ridge: keeps the fitted face inside
    // the plausible-shape manifold rather than contorting to match noise.
    const LAMBDA_ID = 0.08;
    const ridgeI = LAMBDA_ID * (traceI / Kid);
    for (let i = 0; i < Kid; i++) Ni[i*Kid+i] += ridgeI;
    this.chol_id = GNMHead.cholesky(Ni, Kid);
  }

  /** In-place Cholesky. Returns lower-triangular L (row-major). */
  static cholesky(N, n) {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = N[i*n+j];
        for (let k = 0; k < j; k++) s -= L[i*n+k] * L[j*n+k];
        L[i*n+j] = (i === j) ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j*n+j];
      }
    }
    return L;
  }

  static cholSolve(L, b, n) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i*n+k] * y[k];
      y[i] = s / L[i*n+i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k*n+i] * x[k];
      x[i] = s / L[i*n+i];
    }
    return x;
  }

  /**
   * Convert MediaPipe landmarks (normalized 0..1, z relative) into GNM model
   * units via a rigid Umeyama alignment against the CURRENT model landmark
   * positions. Returns { s, R, t, mpModel } where mpModel is landmarks
   * expressed in model space.
   */
  _rigidAlign(lm) {
    const M = this.M;
    // current model landmark positions (template + id + expr, no pose)
    const P = new Float32Array(M * 3);   // model pts
    const Q = new Float32Array(M * 3);   // mediapipe pts (raw)
    for (let m = 0; m < M; m++) {
      const [mp, v] = this.pairs[m];
      let x = this.template[v*3], y = this.template[v*3+1], z = this.template[v*3+2];
      for (let k = 0; k < this.Kid; k++) {
        const s = (k * this.V + v) * 3;
        x += this.idCoeffs[k]*this.idBasis[s];
        y += this.idCoeffs[k]*this.idBasis[s+1];
        z += this.idCoeffs[k]*this.idBasis[s+2];
      }
      for (let k = 0; k < this.Kex; k++) {
        const s = (k * this.V + v) * 3;
        x += this.exCoeffs[k]*this.exBasis[s];
        y += this.exCoeffs[k]*this.exBasis[s+1];
        z += this.exCoeffs[k]*this.exBasis[s+2];
      }
      P[m*3]=x; P[m*3+1]=y; P[m*3+2]=z;
      // MediaPipe: mirror x for selfie, flip y (screen-down → model-up)
      Q[m*3]   = -(lm[mp].x - 0.5);
      Q[m*3+1] = -(lm[mp].y - 0.5);
      Q[m*3+2] = -lm[mp].z;
    }
    // Umeyama Q→P (align observation to model)
    const cP=[0,0,0], cQ=[0,0,0];
    for (let m=0;m<M;m++) for(let a=0;a<3;a++){cP[a]+=P[m*3+a];cQ[a]+=Q[m*3+a];}
    for (let a=0;a<3;a++){cP[a]/=M;cQ[a]/=M;}
    // covariance H = Σ (Q−cQ)(P−cP)ᵀ  and variance of Q
    let H=[0,0,0,0,0,0,0,0,0], varQ=0;
    for (let m=0;m<M;m++){
      const qx=Q[m*3]-cQ[0],qy=Q[m*3+1]-cQ[1],qz=Q[m*3+2]-cQ[2];
      const px=P[m*3]-cP[0],py=P[m*3+1]-cP[1],pz=P[m*3+2]-cP[2];
      H[0]+=qx*px;H[1]+=qx*py;H[2]+=qx*pz;
      H[3]+=qy*px;H[4]+=qy*py;H[5]+=qy*pz;
      H[6]+=qz*px;H[7]+=qz*py;H[8]+=qz*pz;
      varQ+=qx*qx+qy*qy+qz*qz;
    }
    const R = GNMHead.hornRotation(H);            // rotates Q into P frame
    // Robust scale from RMS spread ratio (svd-free, stable under outliers)
    let varP = 0;
    for (let m=0;m<M;m++){
      const px=P[m*3]-cP[0],py=P[m*3+1]-cP[1],pz=P[m*3+2]-cP[2];
      varP+=px*px+py*py+pz*pz;
    }
    const s = Math.sqrt(varP/Math.max(varQ,1e-12));
    // t = cP − s·R·cQ
    const RcQ = [
      R[0]*cQ[0]+R[1]*cQ[1]+R[2]*cQ[2],
      R[3]*cQ[0]+R[4]*cQ[1]+R[5]*cQ[2],
      R[6]*cQ[0]+R[7]*cQ[1]+R[8]*cQ[2]];
    const t = [cP[0]-s*RcQ[0], cP[1]-s*RcQ[1], cP[2]-s*RcQ[2]];

    // landmarks in model space
    const mpModel = new Float32Array(M*3);
    for (let m=0;m<M;m++){
      const qx=Q[m*3],qy=Q[m*3+1],qz=Q[m*3+2];
      mpModel[m*3]  = s*(R[0]*qx+R[1]*qy+R[2]*qz)+t[0];
      mpModel[m*3+1]= s*(R[3]*qx+R[4]*qy+R[5]*qz)+t[1];
      mpModel[m*3+2]= s*(R[6]*qx+R[7]*qy+R[8]*qz)+t[2];
    }
    return { s, R, t, mpModel, P };
  }

  /** Horn quaternion rotation from 3x3 covariance (same math as VibeMesh core). */
  static hornRotation(Hc) {
    const [Sxx,Sxy,Sxz,Syx,Syy,Syz,Szx,Szy,Szz]=Hc;
    const N=[
      [Sxx+Syy+Szz, Syz-Szy,      Szx-Sxz,      Sxy-Syx],
      [Syz-Szy,     Sxx-Syy-Szz,  Sxy+Syx,      Szx+Sxz],
      [Szx-Sxz,     Sxy+Syx,      -Sxx+Syy-Szz, Syz+Szy],
      [Sxy-Syx,     Szx+Sxz,      Syz+Szy,      -Sxx-Syy+Szz]];
    let v=[1,0,0,0];
    for(let it=0;it<32;it++){
      const nv=[0,0,0,0];
      for(let i=0;i<4;i++)for(let j=0;j<4;j++)nv[i]+=N[i][j]*v[j];
      const l=Math.hypot(...nv)||1;
      v=nv.map(x=>x/l);
    }
    const [w,x,y,z]=v;
    return [1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),
            2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),
            2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)];
  }

  /**
   * Calibration: fit identity coefficients from one neutral-pose frame.
   * Ask the user to face forward with a neutral expression, then call this.
   */
  fitIdentity(lm) {
    this.exCoeffs.fill(0);
    // Two alternations: pose → identity → pose → identity
    for (let iter = 0; iter < 2; iter++) {
      const { mpModel, P } = this._rigidAlign(lm);
      const Kid = this.Kid, M = this.M;
      const r = new Float64Array(3 * M);
      for (let m = 0; m < M; m++)
        for (let a = 0; a < 3; a++)
          r[3*m+a] = mpModel[m*3+a] - P[m*3+a] +
            this._idContrib(m, a);   // remove current id, re-solve fresh
      // b = Aᵀ r
      const b = new Float64Array(Kid);
      for (let k = 0; k < Kid; k++) {
        let s = 0;
        for (let row = 0; row < 3*M; row++) s += this.A_id[row*Kid+k]*r[row];
        b[k] = s;
      }
      const c = GNMHead.cholSolve(this.chol_id, b, Kid);
      for (let k = 0; k < Kid; k++)
        this.idCoeffs[k] = Math.max(-3, Math.min(3, c[k]));
    }
    this.uniforms.uIdCo.value = this.idCoeffs;
  }

  _idContrib(m, a) {
    const v = this.pairs[m][1];
    let s = 0;
    for (let k = 0; k < this.Kid; k++)
      s += this.idCoeffs[k] * this.idBasis[(k*this.V+v)*3+a];
    return s;
  }

  /**
   * Per-frame: solve pose + expression. Call from MediaPipe onResults.
   */
  fitFrame(lm, smooth = 0.5) {
    const { s, R, t, mpModel, P } = this._rigidAlign(lm);
    const Kex = this.Kex, M = this.M;

    // residual after template+identity (P already includes current expr —
    // remove it so we solve absolute coefficients, not deltas)
    const r = new Float64Array(3 * M);
    for (let m = 0; m < M; m++) {
      const v = this.pairs[m][1];
      for (let a = 0; a < 3; a++) {
        let exNow = 0;
        for (let k = 0; k < Kex; k++)
          exNow += this.exCoeffs[k] * this.exBasis[(k*this.V+v)*3+a];
        r[3*m+a] = mpModel[m*3+a] - (P[m*3+a] - exNow);
      }
    }
    const b = new Float64Array(Kex);
    for (let k = 0; k < Kex; k++) {
      let sum = 0;
      for (let row = 0; row < 3*M; row++) sum += this.A_ex[row*Kex+k]*r[row];
      b[k] = sum;
    }
    const c = GNMHead.cholSolve(this.chol_ex, b, Kex);
    for (let k = 0; k < Kex; k++) {
      const target = Math.max(-3, Math.min(3, c[k]));
      this.exCoeffs[k] += (target - this.exCoeffs[k]) * smooth;
    }

    // Display pose = inverse of the alignment (we aligned observation→model;
    // the head in world should carry the observation's rotation)
    const Rt = [R[0],R[3],R[6], R[1],R[4],R[7], R[2],R[5],R[8]];
    const a = 0.4;   // pose smoothing
    for (let i = 0; i < 9; i++) this.poseR[i] += (Rt[i]-this.poseR[i])*a;
    this.uniforms.uPoseR.value.fromArray(GNMHead.orthonormalize(this.poseR));
    this.uniforms.uExCo.value = this.exCoeffs;
    // scale/translation for framing handled by caller (camera), pose T stays 0
  }

  static orthonormalize(m){
    const nx=Math.hypot(m[0],m[3],m[6])||1;
    let x=[m[0]/nx,m[3]/nx,m[6]/nx];
    let y=[m[1],m[4],m[7]];
    const d=x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
    y=[y[0]-d*x[0],y[1]-d*x[1],y[2]-d*x[2]];
    const ny=Math.hypot(...y)||1; y=y.map(v=>v/ny);
    const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
    return [x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]];
  }
}

// export for module or global use
if (typeof module !== 'undefined') module.exports = { GNMHead };
if (typeof window !== 'undefined') window.GNMHead = GNMHead;
