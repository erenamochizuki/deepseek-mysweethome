# v3 technical contract (all team members follow this)

ROOT = this web/ folder (in v4: `../web`). Everything v3 needs lives under ROOT. Never reference
`海边小屋-旧工作区` or any absolute path in code; `tools/check-isolation.mjs` enforces it.
Node v24 built-ins only (+ puppeteer-core copied into ROOT/node_modules). Browser = Edge.
three.js r152 global build at `vendor/three.min.js` (global `THREE`, core only: no OrbitControls,
no EffectComposer, no loaders). Do not edit vendor/.

## Layout
```
build.mjs            node build.mjs [page]   -> dist/<page>.html (single file, works from file://)
serve.mjs            node serve.mjs [--port 5194] [--fb-dir feedback]  static + feedback API
src/NN-name.js       classic scripts, each wrapped `(function(V3){ ... })(window.V3);` (00-core creates V3)
src/NN-name.css      concatenated into <style> in name order
tools/               shoot.mjs montage.mjs gen-image.mjs fb.mjs check-isolation.mjs dsh-cost.mjs
refs/                reference images (concept-girl.png etc.), served at /refs/
feedback/            items/<id>.json + shots/<id>.png (+ trash/)
data/  shots/  docs/  test/
```
Pages (build.mjs PAGES): `studio` = shared modules + 90-studio.js. Shared = every src file
whose number is < 90. Files 90-99 are page entries; a page lists its own entries.
Number bands: 00-09 core/render/stage/vox · 10-39 models (20-girl…) · 40-59 scene · 60-69 ui ·
70-79 feedback tool · 90-99 page entries.
Rules: one IIFE per file; no top-level globals except V3; write files in segments ≤120 lines
per edit (skeleton first with `// @@NEXT@@` markers); `node build.mjs` must report
`syntaxErrors=0` before you hand anything over.

## Core API (00-core.js, 01-render.js)
- `V3.on(ev, fn)`, `V3.off(ev, fn)`, `V3.emit(ev, ...args)`. Events: `init` (renderer+scene ready,
  before first frame), `frame(dt, t)`, `resize(w, h)`, `model(inst)` (a model was shown),
  `state(inst)` (model state changed), `select(path|null)`, `parts-changed`.
- `V3.util`: `clamp, lerp, smooth, rng(seed)->fn, hash3(x,y,z)->[0,1), hex(n)->THREE.Color,
  el(tag, attrs, ...children)->HTMLElement, fmtTime(ms)`.
- `V3.R` (after init): `renderer, scene, camera, ctl, canvas, clock`, `R.t` (seconds, freezable),
  `R.freeze(t|null)`, `R.render()` (render now), `R.snapshot(w?, h?) -> dataURL png`
  (renders then reads the canvas), `R.getView() -> {pos:[3], target:[3], fov}`,
  `R.setView(v)`, `R.frameObject(obj3d, pad=1.3)`, `R.info() -> {fps, draws, tris}`.
- `R.ctl` orbit controller: `target (Vector3), az, el, dist, minDist, maxDist, enabled`,
  `ctl.set({az, el, dist, target}, animate=false)`. Left drag rotate, right/shift drag pan,
  wheel zoom, touch 1 finger rotate / 2 finger pinch+pan. Emits nothing; read state anytime.
- `V3.stage` (02-stage.js): `presets` = [{id, label}] lighting presets (`studio`, `day`,
  `golden`, `night`), `setPreset(id)`, `setBg(css)`, `ground` (Object3D), `turntable(bool)`.

## Parts (00-core.js) — how the feedback tool knows "what was clicked"
- A part path is a Chinese `/`-separated string, e.g. `小鲸鱼/头/刘海`. Every pickable thing gets one.
- `V3.parts.tag(obj3d, path, opts?)` marks an object (opts.label overrides the leaf text).
- Face tags (several sub-parts inside one voxel mesh): mesh.userData.faceTags = string[] (paths)
  and mesh.userData.triTag = Uint16Array (per triangle index into faceTags). Geometry groups:
  one group per faceTag, `materialIndex` = faceTag index, so the mesh material is an array
  and hiding sub-part i = `mesh.material[i] = V3.parts.HIDDEN` (shared invisible material).
- Optional `obj.userData.resolveHit(hit) -> path|null` (e.g. the face decal maps uv -> 眼睛/嘴/腮红).
- `V3.parts.resolve(hit) -> {path, obj, local:[3]}`: resolveHit, else faceTags via
  hit.faceIndex, else nearest ancestor with userData.part. `local` = hit point in the tagged
  object's local space (so pins follow animation).
- `V3.parts.list(rootPath?) -> [path]`, `V3.parts.tree() -> {name, path, children:[]}`,
  `V3.parts.objects(path) -> [{obj, tagIndex|-1}]` (all objects/face groups under path),
  `V3.parts.pickables() -> [Object3D]` (meshes to raycast), `V3.parts.reset()`.
- Highlight / hide / isolate are implemented by the feedback tool (70-79) on top of these.

## Models (00-core.js registry)
```
V3.models.register({ id:'girl', label:'小鲸鱼', build(opts) -> inst })
inst = { id, root:Object3D, update(dt,t)?, states?:{ expr:{label, options:[[id,label]], value},
         pose:{…} }, setState(key, value)?, views?:{ name:{az, el, dist, target:[3]} },
         dispose()? }
V3.models.list() / get(id) / show(id) -> inst (adds root to scene, emits 'model') / current()
```

## Voxel sculpt (03-vox.js) — used by the girl, furniture, shells
`new V3.vox.Grid(nx, ny, nz, {origin:[ox,oy,oz]})` design coords (integers; origin = grid index of
design (0,0,0)). Drawing state: `g.c(colorHex|fn(x,y,z)->hex)`, `g.t(tagPath)`, `g.b(boneIndex)`,
`g.mirror(bool)` (mirror X). Ops (inclusive, design coords): `box(x0,y0,z0,x1,y1,z1)`,
`ell(cx,cy,cz,rx,ry,rz)`, `cyl(cx,cz,r,y0,y1)`, `set(x,y,z)`, `del(...)`/`erase(op…)`,
`paint(op…)` (recolor existing only), `get(x,y,z)`. Mesher: `V3.vox.mesh(g, {scale, bones:[{pivot:[x,y,z]}],
noise:0.06, ao:0.55}) -> [{bone, geometry, faceTags, triTag}]` (one per bone; faces culled only
against the same bone; AO sees all voxels). Material: `V3.vox.material(faceTagCount)`.

## Test hooks (all pages)
`window.__READY` true after model shown + 4 frames. `window.__errors` = [] of error strings.
`window.__view(str) -> Promise` applies a view string then renders 2 frames. View string tokens
joined by `+`: a named view of the current model (`front`, `side`, `back`, `q34`, `face`),
`cam=px_py_pz_tx_ty_tz`, `model=girl`, `expr=<id>`, `pose=<id>`, `t=<seconds>` (freeze),
`light=<preset>`, `ui=0` (hide all DOM UI), `sel=<path>` (select a part).
`node tools/shoot.mjs --page studio --views "front,side+expr=smile" --out shots/x [--w 1280 --h 800]`.

## Feedback item (feedback/items/<id>.json)
```
{ id:"fb-YYYYMMDD-HHMMSS-xxx", created, updated (ISO), build, page, model,
  part:"小鲸鱼/头/刘海", partLabel, point:{local:[3], world:[3], normal:[3]} | null,
  camera:{pos:[3], target:[3], fov}, state:{expr, pose, t, light},
  category:"形状|颜色|比例|位置|动作|材质|缺失|其他", severity:1|2|3, text,
  status:"open|doing|fixed|closed|wontfix|reopen", shot:"shots/<id>.png",
  // open=新, doing=AI处理中, fixed=AI说修好了, closed=用户确认解决, reopen=用户说还有问题
  thread:[{who:"user|ai", at, text, status?}] }
```
HTTP (serve.mjs, port 5194): `GET /api/fb` -> {items:[…]} newest first · `GET /api/fb/<id>` ·
`POST /api/fb` body = item without id/created + `shotData` (dataURL png) -> {item} ·
`PATCH /api/fb/<id>` body {status?, reply?:{who,text}} -> {item} · `DELETE /api/fb/<id>` (moves to
trash/) · `GET /api/ping` -> {ok, build?}. Pages detect the server via /api/ping; without it they
store in localStorage key `v3.fb.offline` and offer "导出" (download JSON bundle) / "导入".
CLI `node tools/fb.mjs list [--status open] [--part 刘海] | show <id> | reply <id> "text" [--status fixed]
| status <id> <status> | export <file> | import <file> | summary` works on files directly.
