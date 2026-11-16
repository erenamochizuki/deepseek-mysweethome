// 08-hover-outline.js — visible object silhouettes, composited after either render path.
(function (V3) {
  'use strict';
  const H = V3.hoverOutline = {}, stats = H.stats = { frames: 0, passes: 0, meshes: 0, width: 0, height: 0 };
  let rt = null, selectionRt = null, quad = null, cache = new WeakMap();
  const hiddenMask = new THREE.MeshBasicMaterial({ visible: false });
  // owned: mask material -> WeakRef(source material). The cache never keeps a source material alive.
  const targets = [], owned = new Map(), size = new THREE.Vector2();
  // Per-frame scratch, reused so an active outline does not allocate every RAF. Object references are dropped again
  // when a frame ends (H.render is not re-entrant: 01-render calls it once after the scene render).
  const detached = [], selected = new Set(), changedObject = [], changedMaterial = [], changedVisible = [], maskArrays = [];
  const saved = { target: null, autoClear: true, alpha: 1, color: new THREE.Color(), tone: 0, shadow: true, background: null, override: null,
    autoReset: true, viewport: new THREE.Vector4(), scissor: new THREE.Vector4(), scissorTest: false };
  let changedCount = 0, maskArrayCount = 0, current = null;
  const visible = (o, scene) => {
    for (let p = o; p; p = p.parent) { if (!p.visible || p.userData.noPick) return false; if (p === scene) return true; }
    return false;
  };
  const usable = m => m && m.visible !== false && m.opacity > 0 && m.colorWrite !== false;
  const anyUsable = material => {
    if (!Array.isArray(material)) return usable(material);
    for (let i = 0; i < material.length; i++) if (usable(material[i])) return true;
    return false;
  };
  // Mask materials only borrow map / alphaMap / clippingPlanes from their source: drop the references, never dispose them.
  function freeMask(m) { m.map = m.alphaMap = null; m.clippingPlanes = null; m.dispose(); }
  // A source material was disposed (photo replaced, texture variant dropped ...): its mask materials go with it.
  function releaseSource(event) {
    const src = event.target, pair = cache.get(src);
    src.removeEventListener('dispose', releaseSource);
    if (!pair) return;
    cache.delete(src);
    for (const m of pair) if (m) { owned.delete(m); freeMask(m); }
  }
  function maskMaterial(src, selected) {
    let pair = cache.get(src);
    if (!pair) { pair = []; pair.source = new WeakRef(src); cache.set(src, pair); src.addEventListener('dispose', releaseSource); }
    const index = selected ? 1 : 0;
    if (!pair[index]) {
      const m = pair[index] = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
      // Retain Three's map/alpha, skinning and morph chunks; replace only final RGB.
      m.onBeforeCompile = shader => {
        const token = shader.fragmentShader.includes('#include <opaque_fragment>') ? '#include <opaque_fragment>' : '#include <output_fragment>';
        shader.fragmentShader = shader.fragmentShader.replace(token, 'gl_FragColor = vec4(vec3(' + (selected ? '1.0' : '0.0') + '), 1.0);');
      };
      m.customProgramCacheKey = () => 'hover-mask-' + index;
      owned.set(m, pair.source);
    }
    const m = pair[index];
    const test = src.alphaTest || (src.transparent ? .02 : 0);
    if (m.map !== src.map || m.alphaMap !== src.alphaMap || m.alphaTest !== test || m.side !== src.side) m.needsUpdate = true;
    m.map = src.map || null; m.alphaMap = src.alphaMap || null; m.alphaTest = test; m.side = src.side;
    m.opacity = src.opacity; m.visible = usable(src) && (selected || !src.transparent || src.alphaTest > 0);
    m.clippingPlanes = src.clippingPlanes; m.clipIntersection = src.clipIntersection;
    // Preserve only the source offset. Visibility is compared in view space after the two independent depth passes;
    // coplanar outline copies must never compete with their originals in the same depth buffer.
    m.polygonOffset = src.polygonOffset; m.polygonOffsetFactor = src.polygonOffsetFactor; m.polygonOffsetUnits = src.polygonOffsetUnits;
    return m;
  }
  function freeTarget() { for (const t of [rt, selectionRt]) if (t) { t.dispose(); if (t.depthTexture) t.depthTexture.dispose(); } rt = selectionRt = null; stats.width = stats.height = 0; }
  function ensure(renderer) {
    renderer.getDrawingBufferSize(size);
    if (!rt || rt.width !== size.x || rt.height !== size.y) {
      freeTarget(); rt = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
      rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      selectionRt = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
      selectionRt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
      stats.width = size.x; stats.height = size.y;
    }
    if (!quad) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
      const mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
        uniforms: { mask: { value: null }, depth: { value: null }, sceneDepth: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 2 }, near: { value: .02 }, far: { value: 400 }, ortho: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: `varying vec2 vUv; uniform sampler2D mask,depth,sceneDepth; uniform vec2 texel; uniform float radius,near,far,ortho;
float viewDepth(float z){return mix(near*far/(far-z*(far-near)),near+z*(far-near),ortho);}
float tolerance(float z){return max(.0005,z*.00002);}
float visibleMask(vec2 uv){float z=viewDepth(texture2D(depth,uv).x),sceneZ=viewDepth(texture2D(sceneDepth,uv).x);return texture2D(mask,uv).r*step(z,sceneZ+tolerance(sceneZ));}
float tap(vec2 d,float centerDepth){vec2 uv=clamp(vUv+d*texel,texel*.5,vec2(1.)-texel*.5);float z=viewDepth(texture2D(depth,uv).x);return visibleMask(uv)*step(z,centerDepth+tolerance(centerDepth));}
void main(){
// Compare independent depths in world-scale view units: tolerate rounding without pulling hidden geometry forward.
float self=visibleMask(vUv);
if(self>.5)discard;float z=viewDepth(texture2D(sceneDepth,vUv).x);float inner=0.,outer=0.;
for(int i=0;i<8;i++){float a=float(i)*.7853981634;vec2 d=vec2(cos(a),sin(a));inner=max(inner,tap(d*radius,z));outer=max(outer,tap(d*(radius+1.),z));}
float alpha=max(inner*.95,outer*.38);if(alpha<.01)discard;gl_FragColor=vec4(mix(vec3(.27,.23,.14),vec3(1.,.89,.62),inner),alpha);}`
      });
      const mesh = new THREE.Mesh(g,mat), scene = new THREE.Scene(); mesh.frustumCulled = false; scene.add(mesh);
      quad = { mesh, scene, camera: new THREE.OrthographicCamera(-1,1,1,-1,0,1) };
    }
  }
  H.set = objects => { targets.length = 0; if (objects) for (const o of objects) if (o && !targets.includes(o)) targets.push(o); };
  H.clear = () => { targets.length = 0; stats.meshes = 0; stats.passes = 0; };
  function collectSelected(o) { if (o.isMesh && visible(o, current) && anyUsable(o.material)) selected.add(o); }
  // Same result as material.map(maskMaterial) (holes stay holes), written into a reused array.
  function maskArray(src, isSelected) {
    const out = maskArrays[maskArrayCount] || (maskArrays[maskArrayCount] = []); maskArrayCount++;
    out.length = src.length;
    for (let i = 0; i < src.length; i++) { if (i in src) out[i] = maskMaterial(src[i], isSelected); else delete out[i]; }
    return out;
  }
  function maskObject(o) {
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    const i = changedCount++; changedObject[i] = o; changedMaterial[i] = o.material; changedVisible[i] = o.visible;
    if (!o.isMesh || !visible(o, current)) { o.visible = false; return; }
    const isSelected = selected.has(o);
    o.material = Array.isArray(o.material) ? maskArray(o.material, isSelected) : maskMaterial(o.material, isSelected);
  }
  // Put materials / visibility back in the order they were recorded, then let go of the scene's objects.
  function restoreChanged() {
    for (let i = 0; i < changedCount; i++) { const o = changedObject[i]; o.material = changedMaterial[i]; o.visible = changedVisible[i]; changedObject[i] = changedMaterial[i] = null; }
    changedCount = 0;
    for (let i = 0; i < maskArrayCount; i++) maskArrays[i].fill(null);
    maskArrayCount = 0;
  }
  H.render = (renderer, scene, camera) => {
    stats.passes = 0;
    if (!targets.length) return;
    detached.length = 0;
    for (const o of targets) if (!o.parent && o.visible && o.userData.hoverOutlineOnly) detached.push(o);
    for (const o of detached) scene.add(o);
    selected.clear(); current = scene;
    for (const root of targets) if (visible(root, scene)) root.traverseVisible(collectSelected);
    stats.meshes = selected.size;
    for (const o of detached) scene.remove(o);
    if (!selected.size) { detached.length = 0; current = null; return; }
    ensure(renderer);
    saved.target = renderer.getRenderTarget(); saved.autoClear = renderer.autoClear; saved.alpha = renderer.getClearAlpha(); renderer.getClearColor(saved.color); saved.tone = renderer.toneMapping;
    saved.shadow = renderer.shadowMap.autoUpdate; saved.background = scene.background; saved.override = scene.overrideMaterial; saved.autoReset = renderer.info.autoReset;
    renderer.getViewport(saved.viewport); renderer.getScissor(saved.scissor); saved.scissorTest = renderer.getScissorTest();
    try {
      for (const o of detached) scene.add(o);
      scene.background = null; scene.overrideMaterial = null; renderer.shadowMap.autoUpdate = false; renderer.info.autoReset = false;
      renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = true; renderer.setClearColor(0x000000,0); renderer.setScissorTest(false);
      scene.traverse(maskObject);
      // Scene depth excludes detached copies. Their different Float32 origins otherwise create view-dependent z-fighting.
      for (const o of detached) scene.remove(o);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,camera);
      for (const o of detached) scene.add(o);
      // Material visibility preserves traversal through non-selected mesh parents.
      for (let i = 0; i < changedCount; i++) { const o = changedObject[i]; if (o.isMesh && !selected.has(o)) o.material = hiddenMask; }
      renderer.setRenderTarget(selectionRt); renderer.clear(); renderer.render(scene,camera);
      // Restore original scene before the composite; never leave modified shared materials behind.
      restoreChanged();
      scene.background=saved.background;scene.overrideMaterial=saved.override;
      const u=quad.mesh.material.uniforms;u.mask.value=selectionRt.texture;u.depth.value=selectionRt.depthTexture;u.sceneDepth.value=rt.depthTexture;u.texel.value.set(1/rt.width,1/rt.height);
      u.radius.value=2*renderer.getPixelRatio();u.near.value=camera.near;u.far.value=camera.far;u.ortho.value=camera.isOrthographicCamera?1:0;
      renderer.setRenderTarget(saved.target);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);
      renderer.autoClear=false;renderer.render(quad.scene,quad.camera);stats.frames++;stats.passes=3;
    } finally {
      for (const o of detached) scene.remove(o);
      restoreChanged();
      scene.background=saved.background;scene.overrideMaterial=saved.override;renderer.shadowMap.autoUpdate=saved.shadow;
      renderer.toneMapping=saved.tone;renderer.autoClear=saved.autoClear;renderer.setClearColor(saved.color,saved.alpha);renderer.info.autoReset=saved.autoReset;
      renderer.setRenderTarget(saved.target);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);
      saved.target = saved.background = saved.override = null; detached.length = 0; selected.clear(); current = null;
    }
  };
  H.dispose = () => {
    H.clear(); freeTarget();
    // Mask materials are ours, the sources are not: only take our dispose listener off the ones still alive.
    for (const [m, source] of owned) { const src = source.deref(); if (src) src.removeEventListener('dispose', releaseSource); freeMask(m); }
    owned.clear(); cache = new WeakMap();
    changedObject.length = changedMaterial.length = changedVisible.length = maskArrays.length = 0;
    if (quad) { quad.mesh.geometry.dispose(); quad.mesh.material.dispose(); quad = null; }
  };
  V3.on('model',H.dispose);V3.on('resize',freeTarget);
})(window.V3);
