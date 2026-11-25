// A narrow cookbook cabinet that fits the free bay beside the kitchen counter.
(function (V3) {
  'use strict';
  const SEA = 0x497d76, TRIM = 0x305953, OAK = 0xba8554, EDGE = 0x93633e;
  const BRASS = 0xc9964e, CREAM = 0xf8e9c9, RED = 0xb9493d;
  const pitch = .69, bookX = -.12, bookY = 1.17;
  const pageArch = x => .022*Math.sin(Math.PI*Math.abs(x)/.432) + .008*Math.min(1,Math.abs(x)/.04);
  // Coordinates in the original kitchen's frame. First choice is the gap between
  // the bookshelf and stove. Try the other end or an adjacent bay in rearranged kitchens.
  const bays = [[-2.5,-14.62],[2.5,-14.62],[3.5,-14.62],[-2.5,-13.6],[2.5,-13.6]];
  const width = .94, depth = .58, height = 1.47;
  let lastGrid, lastVersion, lastSpot;
  function spot() {
    const hb = V3.houseBlocks;
    if (!hb?.grid) return null;
    if (hb.grid === lastGrid && hb.version === lastVersion) return lastSpot;
    lastGrid = hb.grid; lastVersion = hb.version; lastSpot = null;
    for (const counter of hb.furnPlaced('kitchen_counter')) {
      if (!counter.mv || counter.cell[1] !== V3.layout.house.floorY) continue;
      for (const [x,z] of bays) {
        const mv = counter.mv, point = mv.point([x,1,z]), yaw = mv.yaw(0);
        const a = mv.point([x-width/2,1,z-depth/2]), b = mv.point([x+width/2,1,z+depth/2]);
        const rect = { x0: Math.min(a[0],b[0]), x1: Math.max(a[0],b[0]), z0: Math.min(a[2],b[2]), z1: Math.max(a[2],b[2]) };
        const floor = point[1], room = hb.placedLayout().house;
        if (rect.x0 < room.x0+1 || rect.x1 > room.x1-1 || rect.z0 < room.z0+1 || rect.z1 > room.z1-1) continue;
        const clear = (cx,cz) => {
          const ix = Math.floor(cx), iz = Math.floor(cz);
          return !!hb.grid.at(ix,floor-1,iz) && !hb.grid.at(ix,floor,iz) && !hb.grid.at(ix,floor+1,iz);
        };
        const front = mv.point([x,1,z+.85]);
        if (!clear(front[0],front[2]) || ![rect.x0,rect.x1].every(cx => [rect.z0,rect.z1].every(cz => clear(cx,cz)))) continue;
        lastSpot = { ...rect, point, yaw, height };
        return lastSpot;
      }
    }
    return null;
  }
  V3.recipeDesk = { spot };

  function paintPages() {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 400;
    const pen = canvas.getContext('2d');
    pen.fillStyle = '#fff0cf'; pen.fillRect(0, 0, 640, 400);
    const gutter = pen.createLinearGradient(284, 0, 356, 0);
    gutter.addColorStop(0, '#fff0cf'); gutter.addColorStop(.49, '#c7a57d');
    gutter.addColorStop(.52, '#dabc92'); gutter.addColorStop(1, '#fff0cf');
    pen.fillStyle = gutter; pen.fillRect(284, 0, 72, 400);
    pen.strokeStyle = '#c79f68'; pen.lineWidth = 2;
    pen.strokeRect(16, 15, 281, 369); pen.strokeRect(344, 15, 280, 369);
    pen.textAlign = 'center'; pen.fillStyle = '#385e51'; pen.font = 'bold 44px serif';
    pen.fillText('海 边 食 谱', 156, 83);
    // A tomato study painted on the endpaper.
    const ellipse = (x, y, rx, ry, angle, color) => {
      pen.beginPath(); pen.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); pen.fillStyle = color; pen.fill();
    };
    ellipse(160, 291, 77, 10, 0, '#e5c79a');
    ellipse(142, 219, 58, 71, -.27, '#c8503f');
    ellipse(174, 224, 57, 66, .18, '#df6950');
    ellipse(119, 196, 7, 17, .42, '#f5a077');
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      ellipse(155 + 18 * Math.cos(angle), 161 + 10 * Math.sin(angle), 25, 6, angle, '#55784f');
    }
    pen.textAlign = 'left'; pen.fillStyle = '#9e513a'; pen.font = 'bold 30px serif';
    pen.fillText('食材手记', 374, 75);
    for (let i = 0; i < 4; i++) {
      const y = 125 + 40 * i;
      pen.strokeStyle = '#bd986a'; pen.lineWidth = 3; pen.strokeRect(378, y - 4, 10, 10);
      pen.beginPath(); pen.moveTo(405, y + 4); pen.lineTo(585 - (i % 3) * 22, y + 4); pen.stroke();
    }
    // The pressed sprig repeats the sage paintwork on the cabinet.
    pen.strokeStyle = '#677e4e'; pen.lineWidth = 3;
    pen.beginPath(); pen.moveTo(463, 346); pen.quadraticCurveTo(518, 330, 560, 287); pen.stroke();
    for (let i = 0; i < 4; i++) {
      ellipse(493 + i * 15, 321 - i * 10, 13, 5, -1.12, '#728b53');
      ellipse(502 + i * 14, 334 - i * 11, 13, 5, -.02, '#889855');
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }

  function build(ctx) {
    const root = new THREE.Group();
    root.name = 'recipe-desk';
    Object.assign(root.userData, { clickable: 'recipeDesk' });
    root.scale.set(.63,.86,.67);
    const frame = V3.shellKit.sculpt(({ add, beam, quad }) => {
      const box = (x,y,z,w,h,d,color,tilt=0) => add(new THREE.BoxGeometry(w,h,d).rotateX(tilt).translate(x,y,z),color);
      const cylinder = (x,y,z,top,base,h,color) => add(new THREE.CylinderGeometry(top,base,h,16).translate(x,y,z),color);
      const oval = (x,y,z,w,h,d,color,tilt=0) => add(new THREE.SphereGeometry(1,12,8).scale(w,h,d).rotateZ(tilt).translate(x,y,z),color);
      // Painted legs, open slatted shelf, breadboard top and a brass-handled drawer.
      for (const x of [-.62,.62]) for (const z of [-.32,.32]) {
        box(x,.44,z,.087,.88,.087,SEA);
        box(x,.08,z,.092,.085,.092,BRASS);
      }
      for (let i = 0; i < 6; i++) box(0,.255,-.31+i*.124,1.31,.049,.115,OAK);
      for (const z of [-.32,.32]) box(0,.20,z,1.32,.09,.068,TRIM);
      for (const x of [-.62,.62]) box(x,.73,0,.085,.22,.71,SEA);
      box(0,.745,0,1.29,.24,.70,TRIM);
      box(0,.745,.361,1.16,.17,.034,SEA);
      for (const x of [-.14,.14]) beam([x,.748,.38],[x,.748,.424],.024,.018,BRASS);
      beam([-.15,.75,.427],[.15,.75,.427],.016,.016,BRASS,10);
      box(0,.884,0,1.44,.069,.84,EDGE);
      for (let i = 0; i < 4; i++) box(0,.929,-.32+i*.21,1.47,.045,.209,i%2 ? 0xcd9b65 : 0xc79460);
      // Rolled tea towel with two woven red bands, draped over the lower shelf.
      box(-.31,.303,.22,.39,.044,.29,CREAM);
      for (let i = 0; i < 12; i++) {
        const x = -.505 + i*.0325, wave = .013*Math.cos(i*1.7);
        const next = .013*Math.cos((i+1)*1.7), bottom = .113+wave*.43;
        const z = .387 + wave, zNext = .387 + next;
        quad([x,.325,.36],[x+.0325,.325,.36],[x+.0325,.325,zNext],[x,.325,z],CREAM,[0,1,0]);
        const strip = (a,b,color) => quad([x,a,z],[x+.0325,a,zNext],[x+.0325,b,zNext],[x,b,z],color,[0,0,1]);
        strip(.325,.165,CREAM); strip(.165,.149,RED); strip(.149,.14,CREAM); strip(.14,.131,RED); strip(.131,bottom,CREAM);
      }
      // Enamel saucepan on the shelf and a turned utensil pot to the right of the book.
      cylinder(.265,.38,.01,.178,.145,.20,0xbd5948);
      cylinder(.265,.488,.01,.184,.184,.021,CREAM);
      cylinder(.265,.51,.01,.105,.177,.031,0xc86b55);
      oval(.265,.548,.01,.041,.027,.028,TRIM);
      beam([.41,.438,.015],[.59,.465,.015],.019,.028,TRIM);
      cylinder(.542,1.05,.12,.088,.069,.194,SEA);
      cylinder(.542,1.151,.12,.091,.091,.019,CREAM);
      cylinder(.542,1.162,.12,.069,.069,.004,TRIM);
      beam([.531,1.13,.122],[.489,1.36,.11],.009,.012,OAK);
      oval(.481,1.393,.11,.032,.051,.011,OAK,.19);
      beam([.548,1.13,.128],[.60,1.397,.13],.009,.012,BRASS);
      for (let i=0;i<3;i++) beam([.594+i*.007,1.397,.13],[.599+i*.01,1.443,.13],.003,.003,BRASS);
      // Curved brass reading lamp, with a rolled lip and a warm interior.
      cylinder(-.595,.97,-.31,.075,.091,.037,BRASS);
      const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(-.595,.981,-.31),new THREE.Vector3(-.63,1.80,-.33),new THREE.Vector3(-.29,1.86,-.23),new THREE.Vector3(-.29,1.60,-.205));
      add(new THREE.TubeGeometry(curve,18,.016,8,false),BRASS);
      cylinder(-.29,1.558,-.205,.046,.121,.091,SEA);
      cylinder(-.29,1.508,-.205,.127,.127,.015,BRASS);
      // The inclined book is supported by a solid easel and a front rail.
      box(bookX,1.075,-.16,.54,.25,.096,EDGE);
      box(bookX,bookY-.021,0,.96,.042,.65,EDGE,pitch);
      const bookPoint = (x,y,z) => [bookX+x,bookY+y*Math.cos(pitch)-z*Math.sin(pitch),y*Math.sin(pitch)+z*Math.cos(pitch)];
      const bookBox = (x,y,z,w,h,d,color) => box(...bookPoint(x,y,z),w,h,d,color,pitch);
      bookBox(0,.012,0,.91,.024,.615,0x944f3e);
      // Alternating page edges follow the shallow hollow at the stitched spine.
      for (let i=0;i<24;i++) {
        const x0 = -.432+i*.036, x1=x0+.036;
        for (const z of [-.286,.286]) for (const [base,cap,col] of [[.024,.038,0xe4c99f],[.038,.043,0xcaaf87],[.043,.067,0xf1d6aa]]) {
          quad(bookPoint(x0,base+pageArch(x0),z),bookPoint(x1,base+pageArch(x1),z),bookPoint(x1,cap+pageArch(x1),z),bookPoint(x0,cap+pageArch(x0),z),col,[0,0,Math.sign(z)]);
        }
      }
      for (const x of [-.432,.432]) bookBox(x,.049,0,.002,.052,.572,0xe6cda7);
      bookBox(0,.024,.322,.94,.074,.029,OAK);
      bookBox(.18,.012,.325,.043,.009,.101,RED);
    });
    const body = new THREE.Mesh(frame,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78}));
    body.castShadow = body.receiveShadow = true;
    const pages = new THREE.PlaneGeometry(.864,.572,24,1).rotateX(-Math.PI/2);
    const points = pages.getAttribute('position');
    for (let i=0;i<points.count;i++) {
      points.setY(i,.067+pageArch(points.getX(i)));
    }
    pages.computeVertexNormals();
    pages.rotateX(pitch).translate(bookX,bookY,0);
    const map = paintPages();
    const leaf = new THREE.Mesh(pages,new THREE.MeshStandardMaterial({map,roughness:.94}));
    leaf.receiveShadow = true;
    // A pull-out writing shelf puts the working copy within reach of her hands.
    const shelf = new THREE.Group(), shelfParts = V3.shellKit.sculpt(({add}) => {
      add(new THREE.BoxGeometry(.94,.035,.55).translate(0,.74,0),OAK);
      add(new THREE.BoxGeometry(.54,.014,.43).translate(0,.765,-.006),0x964f3d);
      add(new THREE.BoxGeometry(.52,.023,.41).translate(0,.782,-.006),CREAM);
      add(new THREE.BoxGeometry(.95,.05,.023).translate(0,.75,.278),SEA);
    });
    shelf.add(new THREE.Mesh(shelfParts,body.material));
    const workingPage = new THREE.Mesh(new THREE.PlaneGeometry(.52,.41).rotateX(-Math.PI/2),leaf.material);
    workingPage.position.set(0,.795,-.006); shelf.add(workingPage);
    const halfPage = new THREE.PlaneGeometry(.257,.407).rotateX(-Math.PI/2).translate(.1285,0,0);
    const uv = halfPage.getAttribute('uv');
    for (let i=0;i<uv.count;i++) uv.setX(i,.5+uv.getX(i)*.5);
    const turning = new THREE.Mesh(halfPage,new THREE.MeshStandardMaterial({map,side:THREE.DoubleSide,roughness:.94}));
    const hinge = new THREE.Group();
    hinge.position.set(0,.798,-.006);
    hinge.add(turning); shelf.add(hinge); root.add(shelf);
    shelf.visible = false;
    const pencil = V3.shellKit.sculpt(({add}) => {
      add(new THREE.ConeGeometry(.009,.028,6).rotateZ(Math.PI).translate(0,.014,0),0x564638);
      add(new THREE.CylinderGeometry(.009,.009,.13,6).translate(0,.093,0),0xad5939);
      add(new THREE.CylinderGeometry(.01,.01,.014,6).translate(0,.165,0),BRASS);
    });
    const nib = new THREE.Mesh(pencil,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.73}));
    nib.name = 'recipe-desk:pencil';
    nib.visible = false;
    // World-sized pencil (desk mesh is scaled to the cabinet bay).
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(.111,.103,.009,16),ctx.glowMat(0xffdb9a,{day:.07,night:1.8}));
    bulb.position.set(-.29,1.499,-.205);
    root.add(body,leaf,bulb);
    ctx.lamp({parent:root,pos:[-.29,1.46,-.17],color:0xffdda5,intensity:.5,distance:1.4});
    ctx.recipeDesk = { root, map, turning, shelf, nib, time: 0, kind: null,
      tip:new THREE.Vector3(), grip:new THREE.Vector3(), up:new THREE.Vector3(0,1,0) };
    position(ctx);
    return [root,nib];
  }
  function position(ctx) {
    const desk = ctx.recipeDesk, placement = spot();
    desk.root.visible = !!placement;
    if (!placement || desk.placement === placement) return;
    desk.placement = placement;
    desk.root.position.set(...placement.point);
    desk.root.rotation.y = placement.yaw;
    desk.root.updateMatrixWorld(true);
  }
  function animate(dt, desk) {
    const actor = V3.actor, behavior = actor?.behavior;
    const kind = behavior?.phase === 'action' ? behavior.kind : null;
    const writing = kind === 'recipe_write', reading = kind === 'recipe_read';
    if (kind !== desk.kind) { desk.kind = kind; desk.time = 0; }
    desk.shelf.visible = (reading || writing) && desk.root.visible;
    desk.nib.visible = writing && desk.root.visible;
    desk.turning.visible = false;
    if ((!reading && !writing) || !desk.root.visible) return;
    desk.time += dt;
    const t = desk.time, tip = desk.tip;
    desk.shelf.position.z = .14+.62*Math.min(1,t/.48);
    if (reading) {
      // The right leaf rises from its outside edge, crosses the gutter and settles on the left.
      const progress = Math.min(1,(t%3.3)/1.5), angle = Math.PI*progress;
      desk.turning.visible = progress < 1;
      desk.turning.rotation.z = angle;
      desk.turning.localToWorld(tip.set(.215,0,.095));
    } else {
      const line = Math.floor(t/1.4)%4, across = (t%1.4)/1.4;
      desk.shelf.localToWorld(tip.set(.04+.16*across,.797,-.025+.045*line+.01*Math.sin(t*27)));
    }
    desk.grip.copy(tip);
    if (writing) {
      desk.grip.y += .085;
      desk.grip.x += .055*Math.sin(desk.root.rotation.y);
      desk.grip.z += .055*Math.cos(desk.root.rotation.y);
    }
    actor.aimHand(desk.grip);
    if (writing) {
      actor.hand(desk.grip);
      desk.nib.position.copy(tip);
      desk.nib.quaternion.setFromUnitVectors(desk.up, desk.grip.sub(tip).normalize());
    }
  }
  V3.scene.part({id:'recipe-desk', label:'海边食谱台', order:70, build,
    update(dt,t,ctx) { position(ctx); animate(dt,ctx.recipeDesk); },
    dispose(ctx) { ctx.recipeDesk?.map.dispose(); }
  });
})(window.V3);
