#!/usr/bin/env node
/* Is the generated head actually human-proportioned?
 *
 * Every row is a distance the generator produces against a published
 * adult mean (Farkas), not an opinion. The default head is the subject,
 * since every fitted face is a perturbation of it — if the base is a
 * cone, no amount of per-user fitting or skin shading rescues it.
 *
 * Landmarks whose canonical counterpart is ambiguous are deliberately
 * NOT tested. MediaPipe 127/356 sit on the lateral contour near the ear
 * rather than at true frontotemporale, and "fixing" the model to match
 * a mis-chosen norm moves the ruler instead of the geometry.
 *
 * Run:  node test/anthropometry.js
 */
const {chromium}=require('playwright');
const fs=require('fs'), os=require('os'), path=require('path');

// label, landmark pair, canonical mm, tolerance mm
const WIDTHS=[
  ['outer canthal (ex-ex)',  33,263, 90, 5],
  ['inner canthal (en-en)', 133,362, 32, 3],
  ['eye fissure  (en-ex)',   33,133, 31, 2],
  ['bitragion    (t-t)',    234,454,140, 7],
  ['bigonial     (go-go)',  172,397, 97, 6],
  ['nose width   (al-al)',   98,327, 34, 3],
  ['mouth width  (ch-ch)',   61,291, 52, 4],
];
// label, canonical mm, tolerance mm
const VERTS=[['eyeToChin',112,6],['nasionChin',122,7],['noseLen',52,4],
             ['subnChin',72,5],['browToEye',22,4],['mouthToChin',47,4],
             ['lipTotal',21,3]];

const FN=()=>{
  const g=modelGetter(DEFAULT_SHAPE);
  const D=(a,b)=>{const p=g(a),q=g(b);
    return (p&&q)?Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])*1000:null;};
  const Y=i=>g(i)?g(i)[1]*1000:null;
  const eye=(Y(33)+Y(263))/2;
  const pairs={};
  for(const [a,b] of [[33,263],[133,362],[33,133],[234,454],[172,397],[98,327],[61,291]])
    pairs[a+'_'+b]=D(a,b);
  return {pairs, v:{
    eyeToChin:eye-Y(152), nasionChin:Y(168)-Y(152), noseLen:Y(168)-Y(2),
    subnChin:Y(2)-Y(152), browToEye:Y(105)-eye,
    mouthToChin:((Y(61)+Y(291))/2)-Y(152), lipTotal:Y(0)-Y(17)}};
};

(async()=>{
  let html=fs.readFileSync(path.join(__dirname,'..','vibemesh.html'),'utf8')
    .replace(/<script[^>]*mediapipe[^>]*><\/script>\s*/gi,'');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vm-anth-'));
  fs.writeFileSync(path.join(dir,'t.html'),html);
  const launch={args:['--use-gl=angle','--use-angle=swiftshader',
                      '--enable-unsafe-swiftshader','--no-sandbox']};
  if(process.env.CHROMIUM_PATH) launch.executablePath=process.env.CHROMIUM_PATH;
  const b=await chromium.launch(launch);
  const p=await b.newPage({viewport:{width:600,height:600}});
  // the generator is pure data; a missing renderer is not a failure here
  p.on('pageerror',e=>{ if(!/THREE is not defined/.test(e.message)) console.log('ERR',e.message); });
  await p.goto('file://'+path.join(dir,'t.html'));
  await p.waitForTimeout(2500);
  const r=await p.evaluate(FN);
  await b.close(); fs.rmSync(dir,{recursive:true,force:true});

  let bad=0;
  const row=(lab,m,canon,tol)=>{
    const e=m-canon, out=Math.abs(e)>tol; if(out) bad++;
    console.log('  '+lab.padEnd(24),m.toFixed(1).padStart(6),String(canon).padStart(8),
      ((e>0?'+':'')+e.toFixed(1)).padStart(7),
      out?('  <-- '+(e>0?'TOO BIG':'TOO SMALL')):'');
  };
  console.log('WIDTHS                       model    canon    err');
  for(const [lab,a,bb,c,t] of WIDTHS) row(lab,r.pairs[a+'_'+bb],c,t);
  console.log('\nVERTICALS                    model    canon    err');
  for(const [k,c,t] of VERTS) row(k,r.v[k],c,t);

  console.log('\nRATIOS the eye reads first');
  console.log('  mouth / nose width   ',(r.pairs['61_291']/r.pairs['98_327']).toFixed(2),'  canon ~1.53');
  console.log('  outer canthal / head ',(r.pairs['33_263']/r.pairs['234_454']).toFixed(2),'  canon ~0.64');
  console.log('  bigonial / head      ',(r.pairs['172_397']/r.pairs['234_454']).toFixed(2),'  canon ~0.69');

  const n=WIDTHS.length+VERTS.length;
  console.log('\n'+(bad?'FAIL':'PASS')+' — '+bad+' of '+n+' measurements outside tolerance');
  process.exit(bad?1:0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
