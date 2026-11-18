(function (V3) {
  'use strict';
  let live;
  function advance(depth, seconds, weather) {
    const snow = weather.snow || 0, rain = weather.rain || 0;
    const rate = snow * .027 - rain * .047 - (1 - snow) * .0026;
    return Math.max(0, Math.min(1, depth + Math.min(Math.max(seconds, 0), .5) * rate));
  }
  function surface(x, z) {
    const blocks = V3.houseBlocks, layout = blocks?.placedLayout?.() || V3.layout;
    const inside = rect => rect && x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1;
    const terrain = V3.terrain.snowSurface(x, z), solids = blocks?.solids?.(x, z), top = solids?.at(-1)?.[1];
    if (top >= layout.house.eaveY - 1 && (!blocks.furnSolids?.(x, z)?.some(span => span[1] > top))) return { type: 'roof', height: top };
    if (terrain === null || inside(layout.house) || inside(layout.porch) || top > terrain + .04 || blocks?.furnSolids?.(x,z)?.length) return null;
    return { type: 'ground', height: terrain };
  }
  function rebuild(state) {
    for (const mesh of state.root.children.slice()) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    const buffers = { ground: [], roof: [] }, cell = V3.terrain.CELL, site = V3.layout.site;
    for (let x = site.x0; x < site.x1; x += cell) for (let z = site.z0; z < site.z1; z += cell) {
      const patch = surface(x + cell / 2, z + cell / 2); if (!patch) continue;
      const height = patch.height + .012, points = buffers[patch.type];
      points.push(x,height,z, x,height,z+cell, x+cell,height,z+cell, x,height,z, x+cell,height,z+cell, x+cell,height,z);
    }
    for (const [kind, points] of Object.entries(buffers)) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3)); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, state.material); mesh.name = 'snow:' + kind; mesh.receiveShadow = true;
      Object.assign(mesh.userData, { noPick: true, noShadow: true }); state.root.add(mesh);
    }
    state.version = V3.houseBlocks?.version ?? 0;
  }
  V3.snowCover = { advance, surface, get depth() { return live?.depth || 0; } };
  V3.scene?.part({ id: 'snow-cover', order: 39, build() {
    const root = new THREE.Group(), uniform = { value: 0 };
    const material = new THREE.MeshLambertMaterial({ color: 0xf6f8f4, polygonOffset: true, polygonOffsetFactor: -1 });
    material.onBeforeCompile = shader => {
      shader.uniforms.snowDepth = uniform;
      shader.vertexShader = 'uniform float snowDepth; varying vec2 snowXZ;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nsnowXZ = position.xz; transformed.y += .038 * snowDepth;');
      shader.fragmentShader = 'uniform float snowDepth; varying vec2 snowXZ;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 cell = floor(snowXZ * 5.0); float grain = fract(sin(dot(cell,vec2(26.17,75.83))) * 4375.17);
        float bank = .5 + .25 * sin(snowXZ.x*2.1 + sin(snowXZ.y*2.7)) + .25 * sin(snowXZ.y*1.8 + snowXZ.x);
        if (.62 * bank + .38 * grain > snowDepth) discard;
        diffuseColor.rgb *= .91 + .09 * grain;`);
    };
    root.name = 'snow-cover'; root.visible = false;
    live = { root, uniform, material, depth: 0, version: -1 }; return root;
  }, update(delta, time, ctx) {
    if (!live) return;
    live.depth = advance(live.depth, delta, V3.env?.state?.wx || {});
    live.root.visible = live.depth > .004; if (!live.root.visible) return;
    if (live.version !== (V3.houseBlocks?.version ?? 0)) rebuild(live);
    live.uniform.value = live.depth; live.root.children[1].visible = !ctx?.state?.floor || ctx.state.floor === 'all';
  }, dispose() { if (live && !live.root.children.length) live.material.dispose(); live = null; } });
})(window.V3);
