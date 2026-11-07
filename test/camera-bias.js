#!/usr/bin/env node
/* Calibration geometry regression test.
 *
 * QUESTION (asked 2026-11-07): if the subject is not aligned with the
 * camera, does the calibrator mis-measure anatomy?
 *
 * METHOD: take a known parameter set S*, read its true metric landmarks
 * straight off the generator, then photograph it through a REAL pinhole
 * for each of the five calibration views. Two independent nuisances:
 *
 *   ox,oy  where the face sits relative to the lens, as a tangent
 *          (0 = dead on, 0.12 ~ 7 deg, 0.25 ~ 14 deg)
 *   pitch0 residual head pitch in the supposedly-frontal view
 *
 * MediaPipe's z is synthesised EXACT, so the only error under test is
 * the x/y projection and what the pipeline does with it. Everything
 * downstream -- toModel, solveCamera, undoPerspective, alignCloud,
 * convergence, canonicalisePose, fitShape -- is the shipping code.
 *
 * METRICS
 *   M1  |measured - true| over the 18 MEAS, in mm
 *   M2  mean |S_fit - S*| over the 17 FITP parameters
 *   k   recovered camera (true k = 1/0.45 = 2.22)
 *
 * GATE: mean M1 at REALISTIC must stay under 2.0 mm AND within 1.5x the
 * on-axis value. The point is that the camera must not matter; absolute
 * accuracy is a separate question tracked by the per-measurement table.
 *
 * Run:  node test/camera-bias.js        (needs playwright + chromium)
 */
const {chromium}=require('playwright');
const fs=require('fs'), os=require('os'), path=require('path');

const PAGE_FN=()=>{
  const ap=(R,p)=>[R[0]*p[0]+R[1]*p[1]+R[2]*p[2],
                   R[3]*p[0]+R[4]*p[1]+R[5]*p[2],
                   R[6]*p[0]+R[7]*p[1]+R[8]*p[2]];
  const I=[1,0,0,0,1,0,0,0,1];
  const Ry=a=>{const c=Math.cos(a),s=Math.sin(a);return[c,0,s,0,1,0,-s,0,c];};
  const Rx=a=>{const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,c,-s,0,s,c];};
  const mul=(A,B)=>{const o=new Array(9).fill(0);
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)o[i*3+j]+=A[i*3+k]*B[k*3+j];
    return o;};

  // Ground truth: the generator's own landmarks, in metres. Landmarks a
  // measurement uses get their true semantic position; the rest get a
  // deterministic surface sample so RIGID alignment and the camera
  // solve have real points to work with.
  function truthCloud(S){
    const P=derived(S), specs=anchorSpecs(P), o=new Float32Array(8);
    const pts=new Array(468).fill(null);
    for(const [lm,ax,ay] of specs){
      const sgn=ax===0?0:(lmSide(lm)||1), tx=sgn*ax;
      const yPre=ay<0?ay/P.FL:ay;
      const phi=Math.acos(Math.max(-1,Math.min(1,yPre/P.B)));
      const sphi=Math.sin(phi)||1e-6;
      const th=Math.asin(Math.max(-1,Math.min(1,tx/(P.A*sphi))));
      sculptPoint(th,phi,S,P,o); pts[lm]=[o[0],o[1],o[2]];
    }
    for(let i=0;i<468;i++){ if(pts[i])continue;
      const fr=x=>x-Math.floor(x);
      sculptPoint((fr(Math.sin(i*12.9898)*43758.5453)-0.5)*2.2,
                  0.35+fr(Math.sin(i*78.233)*43758.5453)*2.2, S, P, o);
      pts[i]=[o[0],o[1],o[2]];
    }
    return pts;
  }

  const AX=4/3, ZG=1.25, G=AX*ZG, FH=1.072;    // focal/height ~ 50 deg vfov
  function shoot(pts,R,D,ox,oy){
    const r=pts.map(p=>ap(R,p));
    const cam=r.map(c=>[ox*D+c[0], oy*D+c[1], D-c[2]]);  // model +z faces lens
    // selfie cameras mirror, which is the sign toModel expects
    const uv=cam.map(c=>[ -(FH*c[0]/c[2])*0.75+0.5, -(FH*c[1]/c[2])+0.5 ]);
    const X=(uv[33][0]-uv[263][0])*AX, Y=uv[33][1]-uv[263][1];
    const dzr=r[33][2]-r[263][2], C=canthalRef();
    const s=Math.sqrt(Math.max((C*C-dzr*dzr/(G*G))/(X*X+Y*Y),1e-12));
    const czr=(r[33][2]+r[263][2])/2;
    return uv.map((u,i)=>({x:u[0],y:u[1],z:-(r[i][2]-czr)/(G*s)}));
  }

  // the shipping calibration path, view for view
  function pipeline(pts,D,ox,oy,pitch0){
    const base=mul(Rx(pitch0),I);
    const V={center:shoot(pts,base,D,ox,oy),
      left :shoot(pts,mul(base,Ry( 25*Math.PI/180)),D,ox,oy),
      right:shoot(pts,mul(base,Ry(-25*Math.PI/180)),D,ox,oy),
      up   :shoot(pts,mul(base,Rx( 18*Math.PI/180)),D,ox,oy),
      down :shoot(pts,mul(base,Rx(-18*Math.PI/180)),D,ox,oy)};
    const keys=Object.keys(V);
    const raw=keys.map(k=>toModel(V[k]));
    const cam=solveCamera(raw);
    const cv=raw.map(v=>undoPerspective(v,cam.k,cam.a,cam.b));
    const ref=cv[keys.indexOf('center')];
    const acc=new Float64Array(468*3), w=new Float64Array(468*3);
    for(let j=0;j<468*3;j++){acc[j]=ref[j]*2;w[j]=2;}
    for(let v=0;v<cv.length;v++){ if(keys[v]==='center')continue;
      const al=alignCloud(cv[v],ref);
      for(let j=0;j<468*3;j++){acc[j]+=al[j];w[j]+=1;} }
    const fused=new Float32Array(468*3);
    for(let j=0;j<468*3;j++) fused[j]=acc[j]/w[j];
    return {corr:canonicalisePose(fused), conf:convergence(cv,fused),
            k:cam.k, a:cam.a, b:cam.b};
  }

  function trial(Sstar,ox,oy,pitch0){
    const pts=truthCloud(Sstar);
    const {corr,conf,k,a,b}=pipeline(pts,0.45,ox,oy,pitch0);
    const gTrue=lm=>pts[lm]||null, gObs=cloudGetter(corr,conf);
    const m1={}; let worst=0,worstKey='',sum=0,n=0;
    for(const key in MEAS){
      const t=MEAS[key](gTrue), o=MEAS[key](gObs);
      if(!isFinite(t)||!isFinite(o)) continue;
      const e=(o-t)*1000; m1[key]=+e.toFixed(2);
      sum+=Math.abs(e); n++;
      if(Math.abs(e)>worst){worst=Math.abs(e);worstKey=key;}
    }
    const S0=measToShape(measureCloud(corr));
    const anchors=orientAnchors(findAnchorVerts(buildHead(S0,{NA:112,NP:88})),corr);
    const res=fitShape(corr,conf,anchors,S0,6);
    let ps=0,pn=0,pw=0,pwk='';
    for(const [key] of FITP){
      const d=Math.abs(res.S[key]-Sstar[key]);
      if(!isFinite(d))continue; ps+=d; pn++;
      if(d>pw){pw=d;pwk=key;}
    }
    return {m1, mean:+(sum/Math.max(n,1)).toFixed(2), nMeas:n,
      worst:+worst.toFixed(2), worstKey, m2:+(ps/Math.max(pn,1)).toFixed(4),
      pw:+pw.toFixed(3), pwk, k:+k.toFixed(2), a:+a.toFixed(2), b:+b.toFixed(2)};
  }

  const Sstar=Object.assign({},DEFAULT_SHAPE,{
    headW:1.06, faceLen:1.09, jawW:0.92, noseLen:1.14, noseW:0.88,
    noseProj:1.22, mouthW:1.05, lipFull:0.86, browHeight:1.11,
    // the canthal span is the ruler a monocular capture normalises by,
    // so eye spacing and size are not recoverable in absolute terms
    eyeSpacing:1.00, eyeSize:1.00, chinProj:1.18, cheekProm:1.24,
    tempHollow:0.62, fatMalar:0.33, fatBuccal:0.28, fatJowl:0.12});

  const D=Math.PI/180;
  return {
    onAxis   : trial(Sstar, 0.00, 0.00, 0),
    off12    : trial(Sstar, 0.12, 0.00, 0),
    off20    : trial(Sstar, 0.20, 0.00, 0),
    low20    : trial(Sstar, 0.00,-0.20, 0),        // camera below the face
    pitch10  : trial(Sstar, 0.00, 0.00, 10*D),     // head not actually frontal
    REALISTIC: trial(Sstar, 0.00,-0.20, 10*D),     // phone on a desk
    worstCase: trial(Sstar, 0.25,-0.25, 15*D),
  };
};

(async()=>{
  const src=path.join(__dirname,'..','vibemesh.html');
  let html=fs.readFileSync(src,'utf8')
    .replace(/<script[^>]*mediapipe[^>]*><\/script>\s*/gi,'');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vm-cam-'));
  fs.writeFileSync(path.join(dir,'t.html'),html);

  const launch={args:['--use-gl=angle','--use-angle=swiftshader',
                      '--enable-unsafe-swiftshader','--no-sandbox']};
  if(process.env.CHROMIUM_PATH) launch.executablePath=process.env.CHROMIUM_PATH;
  const b=await chromium.launch(launch);
  const p=await b.newPage({viewport:{width:800,height:600}});
  // The whole calibration path -- sculptPoint, toModel, solveCamera,
  // fitShape -- is pure data, so a missing renderer does not invalidate
  // anything here. Offline (or behind a CDN block) THREE simply fails to
  // load; that one error is expected and not a test failure.
  const errs=[];
  p.on('pageerror',e=>{ if(!/THREE is not defined/.test(e.message)) errs.push(e.message); });
  await p.goto('file://'+path.join(dir,'t.html'));
  await p.waitForTimeout(2500);
  const r=await p.evaluate(PAGE_FN);
  await b.close();
  fs.rmSync(dir,{recursive:true,force:true});
  if(errs.length) console.log('page errors:',errs.slice(0,3).join(' | '));

  console.log('true k = 2.22  (camera at 45 cm)\n');
  for(const key of Object.keys(r)){
    const t=r[key];
    console.log(key.padEnd(10),
      'M1 mean',String(t.mean).padStart(6)+'mm',
      'worst',String(t.worst).padStart(6)+'mm',t.worstKey.padEnd(10),
      'n='+String(t.nMeas).padStart(2),
      'M2',String(t.m2).padStart(7),
      'k',String(t.k).padStart(5),'a',String(t.a).padStart(6),'b',String(t.b).padStart(6));
  }
  console.log('\nper-measurement error (mm), onAxis -> REALISTIC:');
  for(const k in r.REALISTIC.m1)
    console.log('  '+k.padEnd(12),String(r.onAxis.m1[k]).padStart(8),'->',
                String(r.REALISTIC.m1[k]).padStart(8));

  const ok = r.REALISTIC.mean < 2.0 && r.REALISTIC.mean < r.onAxis.mean*1.5;
  console.log('\n'+(ok?'PASS':'FAIL')+
    ' — realistic '+r.REALISTIC.mean+'mm vs on-axis '+r.onAxis.mean+'mm (gate: <2.0mm and <1.5x)');
  process.exit(ok?0:1);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
