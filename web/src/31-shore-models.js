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
  const isletRigs = new WeakMap();
  // Width, height, and nose-to-tail length relative to the approved adult.
  const isletSize = [[.64,.73,.59],[.71,.78,.67],[.78,.83,.75],[.85,.89,.83],[.93,.945,.915],[1,1,1]];
  const islandLayers = ['moss_rock','coral_1','coral_2','tide_pool','tide_arch','flower_crown'];
  // Takes the build root, including one restored by THREE.ObjectLoader. Its model-unit
  // scale and the tail joint's live swim rotation belong to the caller, never to this pose.
  function poseIslet(mesh, stage = 5) {
    let rig = isletRigs.get(mesh);
    if (!rig) {
      const get = name => mesh.getObjectByName(name);
      rig = { body:get('islet_body'), deck:get('islet_deck'), socket:get('deck_socket'),
        coats:isletSize.map((_,i)=>get('coat_'+i)), fans:isletSize.map((_,i)=>get('fan_'+i)),
        layers:islandLayers.map(get), stage:-1 };
      isletRigs.set(mesh,rig);
    }
    stage = Number.isFinite(stage) ? Math.min(5,Math.max(0,Math.trunc(stage))) : 5;
    if (stage !== rig.stage) {
      rig.body.scale.fromArray(isletSize[stage]);
      rig.deck.position.copy(rig.socket.position).multiply(rig.body.scale);
      for (let i=0;i<isletSize.length;i++) {
        rig.coats[i].visible = rig.fans[i].visible = i === stage;
        rig.layers[i].visible = i <= stage;
      }
      rig.stage = stage;
    }
    return mesh;
  }
  // Project the pigment in object space. The wave follows a flank on upright fish
  // and the broad dorsal surface on rays and flatfish, even when the fish turns.
  const finishes = new WeakMap();
  function skinMaterial(original, pattern, flat, instanced = false) {
    const key = [pattern,flat,instanced].join(':');
    let byFinish = finishes.get(original);
    if (!byFinish) finishes.set(original,byFinish=new Map());
    if (byFinish.has(key)) return byFinish.get(key);
    const mat = original.clone();
    mat.userData.shared = true;
    mat.customProgramCacheKey = () => 'fish-skin-v1:' + key;
    mat.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec3 fishCoord; varying vec2 skinUV; varying float marking;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>', 'skinUV = fishCoord.z' + (flat ? 'x;' : 'y;'),
        instanced ? 'marking = instanceColor.r;' : 'marking = ' + pattern.toFixed(1) + ';',
        // Reef geometry is batched. Shape only the tailward quarter of each instance.
        instanced ? 'float tailWeight = 1.0 - smoothstep(0.03,0.30,fishCoord.z); transformed.z *= 1.0 + instanceColor.g * 0.19 * tailWeight; transformed.'+(flat?'x':'y')+' *= 1.0 + instanceColor.g * 0.24 * tailWeight;' : '',
      ].join('\n'));
      if (instanced) shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
        '#undef USE_INSTANCING_COLOR\n#include <color_vertex>\n#define USE_INSTANCING_COLOR');
      shader.fragmentShader = 'varying vec2 skinUV; varying float marking;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = skinUV;
        float region = smoothstep(.10,.25,p.x) * (1.-smoothstep(.74,.88,p.x)) * smoothstep(.06,.28,p.y);
        vec2 fleck = vec2(p.x*9., p.y*5.);
        fleck.x += .5*mod(floor(fleck.y),2.);
        float pearl = 1.-smoothstep(.15,.23,length(fract(fleck)-.5));
        float saddle = smoothstep(.34,.65,cos(29.*p.x + 3.7*p.y + .45*sin(8.*p.y)));
        float wave = smoothstep(.59,.82,cos(20.*p.y + 1.6*sin(8.*p.x)));
        if(marking>.5 && marking<1.5) diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.93,.80,.58),.7*pearl*region);
        if(marking>1.5 && marking<2.5) diffuseColor.rgb *= 1.-.58*saddle*region;
        if(marking>2.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*.52+vec3(.26,.19,.09), wave*region);
      `);
    };
    byFinish.set(key,mat);
    return mat;
  }
  function skinCoords(geometry) {
    if (geometry.getAttribute('fishCoord')) return;
    geometry.computeBoundingBox();
    const {min,max} = geometry.boundingBox, pos = geometry.getAttribute('position'), coords = new Float32Array(pos.count*3);
    for (let i=0;i<pos.count;i++) {
      coords[3*i]=(pos.getX(i)-min.x)/Math.max(.0001,max.x-min.x);
      coords[3*i+1]=(pos.getY(i)-min.y)/Math.max(.0001,max.y-min.y);
      coords[3*i+2]=(pos.getZ(i)-min.z)/Math.max(.0001,max.z-min.z);
    }
    geometry.setAttribute('fishCoord',new THREE.BufferAttribute(coords,3));
  }
  const flatSkin = kind => ['flounder','sandray','moonray','manta','dolphin'].includes(kind);
  function dressFish(model, kind, traits) {
    if (!traits) return model;
    const spread = [1,1.22,.83][traits.fin];
    const tail=model.getObjectByName('tail');
    if (tail) {
      tail.scale.z *= spread;
      if (!['seahorse','pipefish','moray','ribboneel','bamboo','sandray','manta','moonray'].includes(kind))
        tail.scale[flatSkin(kind)?'x':'y'] *= spread;
    }
    for (const name of ['fin_left','fin_right']) {
      const fin = model.getObjectByName(name);
      if (fin) fin.scale.x *= spread;
    }
    if (traits.pattern) model.traverse(mesh=>{
      if (!mesh.isMesh || !['main','islet_body'].includes(mesh.parent?.name)) return;
      skinCoords(mesh.geometry);
      mesh.material = skinMaterial(mesh.material,traits.pattern,flatSkin(kind));
    });
    return model;
  }
  function fish(kind, unit, form = 'base', traits) {
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
      return dressFish(model,kind,traits);
    }
    const palette = { goby: 'plain', silverside: 'albino', wrasse: 'mist' }[kind];
    if (!palette) throw Error('缺少鱼类模型：' + kind);
    return dressFish(V3.shellVariants.paint(build('fish', unit), kind, palette),kind,traits);
  }
  V3.shoreModels = { build, wear, fish, poseIslet, skinCoords, skinMaterial, flatSkin };
})(window.V3);
