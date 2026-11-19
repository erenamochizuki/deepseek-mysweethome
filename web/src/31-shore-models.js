(function (V3) {
  'use strict';
  const baked = new WeakMap(), deferredShells = new WeakMap(), radians = Math.PI / 180;
  let material, lanternMaterial, bellMaterial;
  const surfaceMaterials = new WeakMap();
  function materialOf(group) {
    if (!group.surface) return material;
    if (surfaceMaterials.has(group)) return surfaceMaterials.get(group);
    const { w, h, runs } = group.surface, bytes = atob(runs), pixels = new Uint8Array(w * h * 4);
    let offset = 0;
    for (let index = 0; index < bytes.length; index += 5) {
      const count = bytes.charCodeAt(index);
      for (let repeat = 0; repeat < count; repeat++) for (let channel = 1; channel <= 4; channel++) pixels[offset++] = bytes.charCodeAt(index + channel);
    }
    const map = new THREE.DataTexture(pixels, w, h);
    map.colorSpace = THREE.SRGBColorSpace; map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true; map.userData.shared = true;
    const finish = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: .78 });
    const tint = new THREE.Color(group.boxes[0][4]);
    finish.color.setRGB(1 / tint.r, 1 / tint.g, 1 / tint.b);
    finish.userData.shared = true; surfaceMaterials.set(group, finish); return finish;
  }
  function geometry(group) {
    if (baked.has(group)) return baked.get(group);
    const positions = [], normals = [], colors = [], uvs = [];
    for (const [from, to, pivot, angles, faces, rects] of group.boxes) {
      const box = new THREE.BoxGeometry(...to.map((value, axis) => value - from[axis])).toNonIndexed();
      box.translate(...to.map((value, axis) => .5 * (value + from[axis]) - pivot[axis]));
      box.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...angles.map(angle => angle * radians), 'ZYX')));
      box.translate(...pivot.map((value, axis) => value - group.pivot[axis]));
      positions.push(...box.attributes.position.array); normals.push(...box.attributes.normal.array);
      for (let face = 0; face < 6; face++) {
        const color = new THREE.Color(Array.isArray(faces) ? faces[face] : faces);
        for (let corner = 0; corner < 6; corner++) {
          colors.push(color.r, color.g, color.b);
          if (rects) {
            const [left, top, right, bottom] = rects[face], index = face * 6 + corner;
            uvs.push(left + box.attributes.uv.getX(index) * (right - left), bottom + box.attributes.uv.getY(index) * (top - bottom));
          }
        }
      }
    }
    const result = new THREE.BufferGeometry();
    if (uvs.length) result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    for (const [name, values] of [['position', positions], ['normal', normals], ['color', colors]]) result.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
    result.userData.shared = true; baked.set(group, result); return result;
  }
  function build(key, unit) {
    const source = window.__V3_SHORE_MODELS?.[key];
    if (!source) throw new Error('缺少海边模型：' + key);
    if (!material) { material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83 }); material.userData.shared = true; }
    const root = new THREE.Group(); root.scale.setScalar(unit);
    function add(parent, group, origin) {
      const bone = new THREE.Group(); bone.name = group.name; bone.visible = group.visible;
      bone.position.set(...group.pivot.map((value, axis) => value - origin[axis]));
      bone.rotation.set(...group.rotation.map(angle => angle * radians), 'ZYX'); parent.add(bone);
      const populate = () => {
        if (group.boxes.length) { const mesh = new THREE.Mesh(geometry(group), materialOf(group)); mesh.castShadow = true; mesh.receiveShadow = true; bone.add(mesh); }
        for (const child of group.children) add(bone, child, group.pivot);
      };
      if (parent.name === 'shell_mount' && !bone.visible) deferredShells.set(bone, populate); else populate();
    }
    for (const group of source) add(root, group, [0, 0, 0]);
    return root;
  }
  function wear(root, kind = 'moon', pattern = 'plain') {
    const mount = root.getObjectByName('shell_mount'), active = mount.getObjectByName('shell_' + kind) || mount.getObjectByName('shell_moon');
    for (const shell of mount.children) shell.visible = shell === active;
    const populate = deferredShells.get(active);
    if (populate) { populate(); deferredShells.delete(active); }
    active.traverse(mesh => {
      if (!mesh.isMesh) return;
      const original = mesh.userData.original || (mesh.userData.original = mesh.geometry);
      mesh.geometry = pattern === 'plain' ? original : V3.shellVariants.geo(original, pattern);
    });
  }
  function fish(kind, unit, form = 'base') {
    const key = 'fish_' + kind + (form === 'base' ? '' : ':' + form);
    if (window.__V3_SHORE_MODELS?.[key]) {
      const model = build(key, unit);
      if(kind==='rainbell') {
        if(!bellMaterial){bellMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28,transparent:true,opacity:.72,depthWrite:false});bellMaterial.userData.shared=true;}
        for(const side of ['bell_left','bell_right'])model.getObjectByName(side).traverse(part=>{if(part.isMesh)part.material=bellMaterial;});
      }
      if (kind==='pinecone') {
        if (!lanternMaterial) {lanternMaterial=new THREE.MeshBasicMaterial({vertexColors:true});lanternMaterial.userData.shared=true;}
        model.getObjectByName('lanterns')?.traverse(part=>{if(part.isMesh)part.material=lanternMaterial;});
      }
      if (kind === 'mullet') model.scale.z *= 1.24;
      if (kind === 'flyingfish') model.scale.x *= 1.22;
      return model;
    }
    const palette = { goby: 'plain', silverside: 'albino', wrasse: 'mist' }[kind];
    if (!palette) throw Error('缺少鱼类模型：' + kind);
    return V3.shellVariants.paint(build('fish', unit), kind, palette);
  }
  V3.shoreModels = { build, wear, fish };
})(window.V3);
