(function (V3) {
  'use strict';
  const baked = new WeakMap(), radians = Math.PI / 180;
  let material;
  function geometry(group) {
    if (baked.has(group)) return baked.get(group);
    const positions = [], normals = [], colors = [];
    for (const [from, to, pivot, angles, faces] of group.boxes) {
      const box = new THREE.BoxGeometry(...to.map((value, axis) => value - from[axis])).toNonIndexed();
      box.translate(...to.map((value, axis) => .5 * (value + from[axis]) - pivot[axis]));
      box.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...angles.map(angle => angle * radians), 'ZYX')));
      box.translate(...pivot.map((value, axis) => value - group.pivot[axis]));
      positions.push(...box.attributes.position.array); normals.push(...box.attributes.normal.array);
      for (let face = 0; face < 6; face++) {
        const color = new THREE.Color(Array.isArray(faces) ? faces[face] : faces);
        for (let corner = 0; corner < 6; corner++) colors.push(color.r, color.g, color.b);
      }
    }
    const result = new THREE.BufferGeometry();
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
      if (group.boxes.length) { const mesh = new THREE.Mesh(geometry(group), material); mesh.castShadow = true; mesh.receiveShadow = true; bone.add(mesh); }
      for (const child of group.children) add(bone, child, group.pivot);
    }
    for (const group of source) add(root, group, [0, 0, 0]);
    return root;
  }
  function wear(root, kind = 'moon', pattern = 'plain') {
    for (const shell of ['moon', 'top_shell']) {
      const bone = root.getObjectByName('shell_' + shell); bone.visible = shell === kind;
      const mesh = bone.children[0], original = mesh.userData.original || (mesh.userData.original = mesh.geometry);
      mesh.geometry = pattern === 'plain' ? original : V3.shellVariants.geo(original, pattern);
    }
  }
  V3.shoreModels = { build, wear };
})(window.V3);
