# tests

    npm i -D playwright && npx playwright install chromium
    node test/camera-bias.js

Set `CHROMIUM_PATH` if you have a chromium elsewhere.

## camera-bias.js

Asks whether the calibrator still measures a face correctly when the
subject is not lined up with the lens — a phone on a desk, a laptop
camera above the face, a head that is not quite frontal in the "front"
capture.

It takes a known parameter set, reads its true metric landmarks straight
off the generator, photographs them through a real pinhole for each of
the five calibration views, and runs the shipping pipeline over the
result. Because ground truth is known exactly, every measurement error
is attributable.

Exits non-zero if the realistic condition (camera 20% below the face,
head pitched 10°) costs more than 2 mm of mean measurement error, or
more than 1.5× the dead-on-axis case. The point is that **camera
placement must not matter**; absolute accuracy is a separate question
and is tracked by the per-measurement table the test prints.

Recorded result when the geometry fixes landed (2026-11-07):

| condition | mean error | worst | k |
|---|---|---|---|
| on axis | 1.02 mm | 4.51 mm `chinProj` | 2.59 |
| face 20% off centre | 1.04 mm | 3.92 mm | 2.58 |
| camera 20% below | 1.17 mm | 5.18 mm | 2.64 |
| head pitched 10° | 0.93 mm | 4.16 mm | 2.52 |
| realistic (below + pitched) | 0.91 mm | 4.46 mm | 2.44 |
| worst case (14° off, 15° pitch) | 0.89 mm | 4.62 mm | 2.33 |

True `k` is 2.22. Before the fixes the same test read 4.76 mm on axis
and 5.90 mm realistic, `k` swung between 1.55 and 2.10 with camera
placement, and in the worst case only 6 of 18 measurements survived the
convergence filter at all.

**Known residual, camera-independent:** `chinProj` ~4.5 mm and
`chinDrop` ~3.3 mm are the same at every camera position, so they are a
chin-region modelling error rather than a geometry one. Not yet chased.
