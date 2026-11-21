(function (V3) {
  'use strict';
  const clamp = V3.util.clamp;
  function mount(host, options) {
    const initial = options.view || {az:.38, el:.48};
    let yaw = initial.az, elevation = initial.el, zoom = 1, radius = 1;
    const pointers = new Map(), spinning = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer, observer, frame = 0, previous = 0, closed = false;
    const scene = new THREE.Scene(), pivot = new THREE.Group(), camera = new THREE.OrthographicCamera(-1,1,1,-1,.001,20);
    scene.add(pivot, new THREE.HemisphereLight(0xfff9ed,0xb8b2a3,1.05));
    for (const [color, intensity, position] of [[0xfff3df,1.65,[-2,3,3]],[0xe8f4ed,.65,[2,1,-2]]]) {
      const light = new THREE.DirectionalLight(color,intensity); light.position.set(...position); scene.add(light);
    }
    function schedule() {
      if (renderer && !closed && !document.hidden && !frame) frame = requestAnimationFrame(draw);
    }
    function draw(now) {
      frame = 0;
      if (!renderer || closed || document.hidden) return;
      if (spinning && !pointers.size && previous) yaw += Math.min(.08,(now-previous)/1000)*.23;
      previous = now;
      const aspect = Math.max(1,host.clientWidth)/Math.max(1,host.clientHeight), extent = radius*1.04/zoom;
      camera.left = -extent*Math.max(1,aspect); camera.right = -camera.left;
      camera.top = extent*Math.max(1,1/aspect); camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      camera.position.set(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation)).multiplyScalar(radius*4);
      camera.lookAt(0,0,0); renderer.render(scene,camera);
      if (spinning && !pointers.size) schedule();
    }
    function visibility() { previous = 0; if (document.hidden) { cancelAnimationFrame(frame); frame=0; } else schedule(); }
    function discard() {
      cancelAnimationFrame(frame); frame = 0; observer?.disconnect(); document.removeEventListener('visibilitychange',visibility);
      if (renderer) {
        const active = renderer; renderer = null;
        active.domElement.removeEventListener('webglcontextlost',lost); active.dispose(); active.forceContextLoss();
      }
      pivot.clear(); pointers.clear();
    }
    function still() {
      discard(); host.replaceChildren();
      const picture = options.still(); if (picture) host.append(picture);
    }
    function lost(event) { event.preventDefault(); if (!closed && renderer) still(); }
    function reload() {
      if (closed) return;
      if (!renderer) { still(); return; }
      try {
        pivot.clear(); const model = options.build();
        const sphere = options.bounds?.() || new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
        model.position.sub(sphere.center); radius = Math.max(.001,sphere.radius); pivot.add(model);
        camera.near=radius*.01; camera.far=radius*6;
        renderer.domElement.setAttribute('aria-label',options.label()); schedule();
      } catch (error) { V3.err('观赏模型：'+error.message); still(); }
    }
    function magnify(factor) { zoom=clamp(zoom*factor,.7,2); schedule(); }
    const api = {reload,
      dispose() {closed=true; discard(); host.replaceChildren();}};
    try { renderer = new THREE.WebGLRenderer({antialias:true, alpha:true, powerPreference:'low-power'}); }
    catch { still(); return api; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.setClearColor(0,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas = renderer.domElement; canvas.tabIndex = 0; host.replaceChildren(canvas);
    canvas.addEventListener('webglcontextlost',lost);
    canvas.onpointerdown = event => {
      if (event.button!==0 || pointers.size>=2) return;
      pointers.set(event.pointerId,{left:event.clientX,top:event.clientY,distance:0,pinched:false});
      if (pointers.size===2) for (const point of pointers.values()) point.pinched=true;
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = event => {
      const drag=pointers.get(event.pointerId); if (!drag) return;
      const dx=event.clientX-drag.left, dy=event.clientY-drag.top;
      drag.distance+=Math.hypot(dx,dy);
      if (pointers.size===2) {
        const other=Array.from(pointers.values()).find(point=>point!==drag);
        const span=Math.hypot(drag.left-other.left,drag.top-other.top), next=Math.hypot(event.clientX-other.left,event.clientY-other.top);
        if (span>1 && next>1) magnify(next/span);
      } else {yaw-=dx*.012; elevation=clamp(elevation+dy*.012,-1.52,1.52);}
      drag.left=event.clientX; drag.top=event.clientY; schedule();
    };
    canvas.onlostpointercapture = canvas.onpointerup = canvas.onpointercancel = event => {
      const drag=pointers.get(event.pointerId); if (!drag) return;
      const tap=event.type==='pointerup' && !drag.pinched && drag.distance<5; pointers.delete(event.pointerId); previous=0;
      if (tap) options.onTap?.(); schedule();
    };
    canvas.addEventListener('wheel',event=>{event.preventDefault(); magnify(event.deltaY<0?1.1:1/1.1);},{passive:false});
    canvas.onkeydown = event => {
      if (['+','=','-'].includes(event.key)) {event.preventDefault(); magnify(event.key==='-'?1/1.18:1.18); return;}
      if (event.key==='Enter' && options.onTap) {event.preventDefault(); options.onTap(); return;}
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); yaw+=event.key==='ArrowLeft'?-.15:event.key==='ArrowRight'?.15:0;
      elevation=clamp(elevation+(event.key==='ArrowUp'?.15:event.key==='ArrowDown'?-.15:0),-1.52,1.52); schedule();
    };
    const resize=()=>{if(renderer){renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),false);schedule();}};
    observer=new ResizeObserver(resize); observer.observe(host); document.addEventListener('visibilitychange',visibility);
    resize(); reload(); return api;
  }
  V3.modelOrbit = {mount};
})(window.V3);
