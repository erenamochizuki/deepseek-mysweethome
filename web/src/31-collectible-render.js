// Browser geometry and MC JSON share the same cuboids, UVs and pixel atlas.
(function (V3) {
  'use strict';
  const textures = new Map();
  function elements(spec) {
    return spec.elements.map((box) => ({
      from: box.from.slice(), to: box.to.slice(),
      faces: Object.fromEntries(Object.entries(box.faces).map(([dir, rect]) => [dir, {
        texture: '#skin', uv: rect.map((v, i) => v * 16 / (i % 2 ? spec.height : spec.width)),
      }])),
    }));
  }
  function geometry(id) {
    const spec = V3.collectibleCubes.build(id);
    const quads = V3.mcmodel.bakeModel({ elements: elements(spec), textures: { skin: { sprite: id } }, ao: false });
    const positions = [], uv = [], index = [];
    for (const q of quads) {
      const i = positions.length / 3;
      positions.push(...q.pos); uv.push(...q.uv);
      index.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length).fill(1), 3));
    g.setIndex(index); g.addGroup(0, index.length, 0); g.computeVertexNormals();
    g.userData.cuboids = spec.elements.length;
    return g;
  }
  function material(id, roughness) {
    if (textures.has(id)) return textures.get(id);
    const { rgba, width, height } = V3.collectibleCubes.build(id);
    const atlas = new THREE.DataTexture(rgba, width, height);
    atlas.colorSpace = THREE.SRGBColorSpace;
    // MC's atlas UV has (0,0) in the top left; raw RGBA is already top row first.
    atlas.flipY = false; atlas.minFilter = atlas.magFilter = THREE.NearestFilter;
    atlas.generateMipmaps = false; atlas.needsUpdate = true; atlas.userData.shared = true;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness, alphaTest: .5 });
    mat.name = 'V3.collectibleRender.' + id; mat.userData.shared = true;
    textures.set(id, mat);
    return mat;
  }
  V3.collectibleRender = { elements, geometry, material };
})(window.V3);
