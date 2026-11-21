// 朝海窗的陶盆雕塑。尺寸用厘米，合并顶点色和三角面后一次换算成世界坐标。
(function (V3) {
  'use strict';
  const { mix, hash, TAU } = V3.shellKit;
  const { sin, cos, PI } = Math, SOIL = 12, cache = new Map();
  const stemGreen = 0x658246, leafGreen = 0x448454, pale = 0x9dbb72;
  let material;

  // 与拾物一样把各部分缝成一件。相邻截面共用顶点，弯曲的轮廓有连续的法线。
  function sculpt(draw) {
    const positions = [], colors = [], indices = [], color = new THREE.Color();
    function vertex(p, tint) {
      const i = positions.length / 3;
      positions.push(...p); color.setHex(tint); colors.push(color.r, color.g, color.b);
      return i;
    }
    function rings(rows, sides, point, tint, poles = []) {
      let prev;
      for (let j = 0; j <= rows; j++) {
        const count = poles.includes(j) ? 1 : sides;
        const row = Array.from({ length: count }, (_, i) => vertex(point(j/rows, TAU*i/sides, j, i), tint(j/rows, TAU*i/sides, j, i)));
        if (prev) for (let i = 0; i < sides; i++) {
          const k = (i+1)%sides, a = prev[i%prev.length], b = row[i%count], c = row[k%count], d = prev[k%prev.length];
          if (b !== c) indices.push(a,b,c);
          if (a !== d) indices.push(a,c,d);
        }
        prev = row;
      }
    }
    function sheet(n, point, tint) {
      const start = positions.length/3;
      for (let z=0; z<=n; z++) for (let x=0; x<=n; x++) {
        const p=point(2*x/n-1,2*z/n-1); vertex(p,tint(...p));
        if (!x || !z) continue;
        const d=start+z*(n+1)+x, c=d-1, b=d-(n+1), a=b-1;
        if ((x+z)%2) indices.push(a,c,b,b,c,d);
        else indices.push(a,c,d,a,d,b);
      }
    }
    draw(rings,sheet);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices); g.scale(.01,.01,.01); g.computeVertexNormals(); g.userData.shared = true;
    return g;
  }

  // 旋出盆壁和卷边。盆脚中间留有排水孔，孔底和浅托盘之间留一小段空隙。
  function clay(rings,sheet) {
    function lathe(profile, poles = []) {
      rings(profile.length-1, 40, (t,a,j) => {
        const [r,y] = profile[j], warp = r*(1+.003*sin(3*a+.4)+.002*cos(5*a-y*.2));
        return [warp*cos(a),y,warp*sin(a)];
      }, (t,a,j,i) => mix(profile[j][2],0xe4ac80,.075*hash(j,i)+.04*(1+sin(a*3+j*.4))), poles);
    }
    lathe([[0,0,0x98543e],[8,0,0xac6248],[9.2,.35,0xb96e4d],[10.1,1.4,0xc78359],
      [10.3,1.85,0xd39568],[10.1,2.05,0xe0a67a],[9.7,2.0,0xd09363],[9.0,1.1,0x98573d],[0,.8,0x8c503b]], [0,8]);
    lathe([[.7,1.7,0x653f32],[.7,1.25,0x754535],[5.9,1.25,0x9a5c43],[6.35,1.45,0xb97552],
      [6.5,2.0,0xae6549],[6.45,2.3,0xa45a42],[7.15,3.0,0xc47b54],[8.25,6.5,0xc98359],
      [8.85,9.1,0xc88259],[8.94,9.3,0xb47554],[9.04,9.5,0xd89767],[9.15,10.0,0xc7815a],
      [9.25,10.4,0xb16c4b],[9.7,10.52,0xbd7853],[10.12,10.85,0xd19163],[10.25,11.55,0xd99a6b],
      [10.20,12.40,0xd79a6c],[9.94,12.83,0xe6ad80],[9.48,12.96,0xe9b487],[9.13,12.72,0xd49b72],
      [9.04,12.15,0xb77c56],[8.84,11.35,0x946046]]);
    // 用交错三角铺满土面。方形采样弯成圆盘，土色和颗粒按实际位置分布。
    function height(x,z) {
      return SOIL-.13 + .14*sin(1.37*x+.72*z)*cos(.87*z) + .19*hash(x,z) - .17*(x*x+z*z)/82;
    }
    sheet(18,(u,v) => {
      const x=9.1*u*Math.sqrt(1-v*v/2), z=9.1*v*Math.sqrt(1-u*u/2);
      return [x,height(x,z),z];
    }, (x,y,z) => mix(0x473327,0x8c6a4e,.18+.58*hash(x,z)));
    for (let i = 0; i < 22; i++) {
      const a = i*2.4, r = 2.5+Math.sqrt(hash(i,1))*5.9, d = .16+.27*hash(i,2);
      const x=r*cos(a), z=r*sin(a);
      oval(rings,[x,height(x,z)+.04,z], [d,d*.60,d*.76],mix(0x644630,0xc7a580,hash(i,3)), 6, 3);
    }
  }

  function oval(rings,p,size,col,sides=10,rows=5) {
    rings(rows,sides,(t,a) => [p[0]+size[0]*sin(PI*t)*cos(a),p[1]-size[1]*cos(PI*t),p[2]+size[2]*sin(PI*t)*sin(a)],
      (t,a) => mix(col,0xffe7a9,.07*t*(1+.4*cos(a))), [0,rows]);
  }
  function stalk(rings, points, r0, r1, col = stemGreen, sides = 7) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const steps = (points.length-1)*3, frames = curve.computeFrenetFrames(steps,false), centers = curve.getSpacedPoints(steps);
    rings(steps,sides,(t,a,j) => centers[j].clone().addScaledVector(frames.normals[j],cos(a)*(r0+(r1-r0)*t))
      .addScaledVector(frames.binormals[j],-sin(a)*(r0+(r1-r0)*t)).toArray(), (t,a) => mix(col,pale,.12*t+.07*(1+cos(a))));
  }

  // 横截面从右边缘走过隆起的主脉，再沿叶背折回。肩宽、凹口和拱高决定不同叶形。
  function leaf(rings, p, a, length, width, rise, arch, col=leafGreen, shape='oval') {
    const side = [-sin(a),cos(a)], rows = 10, cleft = shape === 'cleft', heart = shape === 'heart';
    // 上表面的主脉两侧各加一条窄截线；厚藤两肩伸过叶尖，留下马蹄形的凹口。
    const angles = [0,.61,1.12,1.49,PI/2,1.65,2.02,2.53,PI,3.83,4.71,5.59];
    function point(t,u,v) {
      const wave = sin(PI*t), w = width*wave**(cleft ? .47 : .72)*(heart ? 1.45-.95*t : .77+.47*t);
      let forward = length*t;
      if (cleft) forward += length*t*t*(.77*u*u*wave**.55-.31*t);
      if (heart) forward -= Math.abs(u)*2.15*wave*(1-t)**2;
      const rib = .38*(1-Math.abs(u)) + .24*v + .14*Math.max(0,1-12*Math.abs(u))*Math.max(0,v);
      const y = p[1]+rise*t+arch*wave+wave*(rib-width*.26*u*u)+.33*side[1]*w*u;
      return [p[0]+cos(a)*forward+side[0]*w*u, y, p[2]+sin(a)*forward+side[1]*w*u];
    }
    rings(rows,angles.length,(t,b,j,i) => point(t,cos(angles[i]),sin(angles[i])), (t,b,j,i) => {
      const u=Math.abs(cos(angles[i])), v=sin(angles[i]), base=v<-.1 ? mix(col,0xabc38a,.27) : col;
      return mix(base,pale,(u<.01 ? .75 : .02)+.08*t+.05*(1+cos(PI*(t*7-u*1.7))));
    }, [0,rows]);
    if (width<2.1) return;
    for (const start of [.28,.54]) for (const sign of [-1,1]) {
      rings(4,4,(t,b) => {
        const u=sign*(.06+.70*t+.026*cos(b)*sin(PI*t)), q=point(start+.22*t,u,Math.sqrt(1-u*u));
        q[1]+=.045+.027*sin(b)*sin(PI*t); return q;
      }, () => mix(col,pale,.42), [0,4]);
    }
  }

  // 花面朝屋内并仰起。u 横向，v 指向上瓣，d 从萼片指向花口。
  function face(p,u,v,d,turn=0) {
    const z = .73*v-.68*d;
    return [p[0]+u*cos(turn)+z*sin(turn),p[1]+.68*v+.73*d,p[2]-u*sin(turn)+z*cos(turn)];
  }
  // 单瓣是闭合的薄壳。卷边、回弯和偏转量沿瓣长变化，转到侧面也看得出厚度。
  function petal(rings,p,a,len,w,options={}) {
    const {base=0xf7e9c4, tip=0xfff9e8, cup=1.2, reflex=0, twist=0, turn=0, fan=.5} = options;
    const rows = w<1 ? 8 : 10, sides = w<1 ? 8 : 12;
    rings(rows,sides,(t,b) => {
      t=(1-cos(PI*t))/2;
      const s=sin(PI*t), u=cos(b), angle=a+twist*t, lateral=w*s**fan*(.68+.60*t)*u;
      const along=len*t, d=cup*t*t + reflex*sin(PI*t) + w*.28*u*u*s + .13*sin(b)*s;
      return face(p,along*cos(angle)-lateral*sin(angle),along*sin(angle)+lateral*cos(angle),d,turn);
    }, (t,b) => mix(base,tip,Math.min(1,.85*(1-cos(PI*t))+.08*(1+cos(3*b))*sin(PI*t))), [0,rows]);
  }

  function bud(rings,p,size,col) {
    const [x,y,z]=p;
    rings(8,12,(t,a) => {
      const w=size*sin(PI*t)**.78*(1+.07*cos(5*a-3*t));
      return [x+w*cos(a)+.45*size*t*t,y+size*2.9*t,z+w*sin(a)-.55*size*t];
    }, (t,a) => t < .27+.11*cos(5*a) ? 0x719050 : mix(col,0xffebca,.12+.19*cos(5*a-3*t)**4),[0,8]);
  }

  function seedling(g, stage, lily) {
    if (lily) {
      leaf(g,[0,0,0],.5,stage === 1 ? 2.3 : 4.1,1.0,stage === 1 ? 4.1 : 7.8,1.8,0x83a959);
      if (stage === 2) leaf(g,[0,.1,0],3.2,4.3,1.2,5.6,2.7);
      return;
    }
    const h = stage === 1 ? 2.35 : 5.1, crown = [.6,h,.1];
    stalk(g,[[0,-.1,0],[-.28,h*.48,.15],crown],.37,.23);
    for (const a of [.45,3.6]) leaf(g,crown,a,h+.7,stage === 1 ? 1.25 : 1.85,1.3,1.0,0x82af60);
    if (stage === 2) leaf(g,crown,1.85,4.6,2.1,3.7,1.6);
  }

  function morningGlory(g, stage) {
    const adult=stage>=4, top=adult ? [-6,20,-1.2] : [-5,12.5,-1];
    stalk(g,[[1,0,1],[3,3,1.8],[-.5,6,1],[-5,8,0],[-7,11,-.5],top],.55,.28,0x886b58);
    for (const [p,a,l] of [[[2.8,3,1.8],.24,8.8],[[-.5,6,1],2.65,8.1],[[-5,8,0],4.0,6.7],
      [[-6.6,11,-.5],.56,8.0],...(adult ? [[[-6.5,16,-.9],2.8,6.9]] : [])]) {
      const q=[p[0]+2.7*cos(a),p[1]+1.4,p[2]+2.7*sin(a)];
      stalk(g,[p,q],.27,.18); leaf(g,q,a,l,3.2,1.0,1.7,0x518657,'cleft');
    }
    if (!adult) return;
    if (stage === 4) return bud(g,top,1.45,0xb778a3);
    // 从细喉到喇叭口。内外两壁在波浪边缘接成一圈，五道浅色褶一直伸向花心。
    const profile=[[.45,-.65],[.8,.6],[1.12,2.2],[1.55,3.7],[2.5,4.95],[4.2,5.85],[6.5,6.25],[7.22,6.17],
      [7.12,6.31],[6.35,6.48],[4.15,6.04],[2.45,5.14],[1.49,3.85],[.95,2.4],[.55,1.28],[0,1.24]];
    g(profile.length-1,45,(t,a,j) => {
      const [r,d]=profile[j], f=(r/7.22)**1.7, fold=cos(5*a+.4*r);
      const edge=r*(1+.063*fold*f);
      return face(top,edge*cos(a),edge*sin(a),d+(.55*fold+.16*sin(10*a))*f);
    },(t,a,j) => {
      const [r]=profile[j], stripe=Math.max(0,cos(5*a+.4*r))**8, outside=j<8;
      return mix(outside ? 0xb8629c : mix(0x81367b,0xd36bad,Math.min(1,r*.16)),0xffcce6,.07+.68*stripe+.13*(r/7));
    },[profile.length-1]);
    oval(g,face(top,0,0,2.85),[.55,.48,.5],0xf6d8aa);
  }

  function beachBean(g, stage) {
    const adult=stage>=4, top = adult ? [3,stage === 5 ? 21.5 : 20,-.8] : [2,12,0];
    stalk(g,[[0,0,0],[-1.4,5,.5],[.6,10,-.7],top],.64,.33);
    for (const [p,a] of [[[-1.4,5,.5],2.9],[[.6,10,-.7],.25],...(adult ? [[[2.1,15,-.7],1.9]] : [])]) {
      const q=[p[0]+4*cos(a),p[1]+1.3,p[2]+4*sin(a)]; stalk(g,[p,q],.29,.19);
      for (const shift of [-.94,0,.94]) leaf(g,q,a+shift,shift ? 5.8 : 7.9,shift ? 2.0 : 2.45,shift ? -.9 : 1.2,1.7,0x548a57);
    }
    if (!adult) return;
    const side=[-4,16.3,-1.3]; stalk(g,[[-.6,7.8,0],[-4.6,12.5,-.1],side],.4,.24);
    bud(g,side,1.0,0xe8bf70);
    if (stage === 4) return bud(g,top,1.65,0xe6bc64);
    // 宽旗瓣直立，左右翼瓣包住向前突出的龙骨瓣。豆荚下垂，纵缝沿荚弯下去。
    petal(g,top,1.65,7.5,5.05,{base:0xbb762b,tip:0xffdf73,cup:-1.0,reflex:.75,fan:.46});
    for (const a of [-.38,PI+.38]) petal(g,top,a,4.95,2.18,{base:0xd69331,tip:0xffcf57,cup:2.65,reflex:1.3});
    petal(g,top,-1.44,3.3,1.6,{base:0xe5a236,tip:0xffe59a,cup:4.0});
    const pod=[-5,14,.1]; stalk(g,[side,pod],.26,.22);
    g(9,8,(t,a) => {const w=.77*sin(PI*t)**.64;return [pod[0]-2.4*sin(PI*t*.8)+w*cos(a),pod[1]-8.5*t,pod[2]+1.15*t+w*.62*sin(a)];},
      (t,a) => mix(0x83974e,0xc5ba74,.14+.45*Math.max(0,cos(a))**6),[0,9]);
  }

  function naupaka(g, stage) {
    const adult=stage>=4, h=adult ? 15 : 9;
    stalk(g,[[0,0,0],[.2,5,.5],[-2.8,h-3,.3],[-4,h,-.5]],.92,.41,0x897553);
    stalk(g,[[.2,5,.5],[3.3,7.8,1.5],[5,h-1.8,2]],.57,.31,0x947b59);
    for (const [p,a] of [[[-4,h,-.5],2.9],[[5,h-1.8,2],.25]]) {
      for (let i=0;i<5;i++) leaf(g,p,a+2.4*i,7.5-i*.45,2.8-i*.12,1.1+i*.58,1.65, i%2 ? 0x548959 : 0x608f62);
    }
    if (!adult) return;
    const top=[-3,18.5,-2.8]; stalk(g,[[-4,h,-.5],[-4.2,17,-1.4],top],.35,.23);
    if (stage===4) return bud(g,top,1.25,0xeee4cd);
    const mouth=face(top,0,0,2.0); stalk(g,[top,face(top,0,0,.9),mouth],.48,.72,0xe8d6aa);
    for (let i=0;i<5;i++) petal(g,mouth,.05+i*.73,6.5+.55*sin(i*.85),1.35,{base:0xe1bd79,tip:0xfff9eb,cup:.65,reflex:.85,fan:.59});
    const style=face(mouth,.25,-1.25,1.6); stalk(g,[mouth,style],.27,.19,0xe6bd77); oval(g,style,[.48,.43,.4],0xf7dc9d);
  }

  function crinum(g, stage) {
    const adult=stage>=4;
    for (let i=0;i<8;i++) {
      const a=i*2.4, base=[.7*cos(a),0,.7*sin(a)], l=(adult ? 12.8 : 9.6)-i*.45;
      leaf(g,base,a,l,1.55,3+i*.95,5.0+i*.32, i%2 ? 0x548f5a : 0x65985d);
    }
    if (!adult) return;
    const crown=[.2,26.4,.3]; stalk(g,[[0,0,0],[1.3,10,.8],[1.05,19,.65],crown],.85,.47,0x719356,9);
    if (stage===4) {
      bud(g,crown,1.5,0xe5e2c9); bud(g,[1.1,26.7,.55],1.12,0xdbe0be); return;
    }
    // 三朵组成顶端花序，每朵六条狭长花被片。先向前拱出，再把细尖向后卷。
    for (const [dx,dy,dz,turn,phase] of [[-5.3,2.7,-1,.74,.2],[4.7,4.0,.9,-1.12,.78],[.1,7.1,1.2,.06,.4]]) {
      const p=[crown[0]+dx,crown[1]+dy,crown[2]+dz];
      stalk(g,[crown,[dx*.53,27.7+dy*.22,dz*.54],p],.34,.26,0xa4b281);
      for (let i=0;i<6;i++) {
        const a=phase+i*TAU/6;
        petal(g,p,a,7.35,.77,{base:0xd7d9ac,tip:0xfffcf1,cup:-2.7,reflex:3.65,twist:.32,turn,fan:.72});
        if (i%2===0) {
          const tip=face(p,2.65*cos(a),2.65*sin(a),3.8,turn);
          stalk(g,[p,face(p,1.1*cos(a),1.1*sin(a),2.2,turn),tip],.10,.07,0xeddfa4,5);
          oval(g,tip,[.32,.18,.23],0xd9a348,6,3);
        }
      }
    }
  }

  function hibiscus(g, stage) {
    const adult=stage>=4, top=adult ? [2,23,-.6] : [1,13,0];
    stalk(g,[[0,0,0],[-.8,6.3,.4],[.7,12.5,.1],top],.92,.36,0x917356,9);
    for (const [p,a,len] of [[[-.7,5,.5],2.9,8.2],[[0,9,.3],.4,8.7],[[.7,12,.1],4.55,7.2],
      ...(adult ? [[[1.2,16,-.2],2.45,7.9],[[1.6,19,-.4],.8,6.3]] : [])]) {
      const q=[p[0]+3.5*cos(a),p[1]+2,p[2]+3.5*sin(a)]; stalk(g,[p,q],.38,.22,0x8b8054);
      leaf(g,q,a,len,len*.46,.2,1.65,0x5d8e54,'heart');
    }
    if (!adult) return;
    if (stage===4) return bud(g,top,1.85,0xe2b567);
    for (let i=0;i<5;i++) petal(g,top,.14+i*TAU/5,9.15+.32*cos(2*i),4.65,{base:0x882b37,tip:i%2 ? 0xffcf4f : 0xffd95e,cup:2.85+.32*sin(i),reflex:-.5,twist:.35,fan:.46});
    oval(g,top,[1.5,1.22,1.5],0x8c3340);
    const column=face(top,.7,.5,5.25); stalk(g,[top,face(top,.15,.1,2.6),column],.39,.24,0xdc9549);
    for (let i=0;i<9;i++) {
      const a=i*2.4,p=face(top,.60+.51*cos(a),.5+.51*sin(a),4.1+i*.16); oval(g,p,[.3,.28,.31],i<6 ? 0xf4b443 : 0xba5947,6,3);
    }
  }

  const kinds = new Map([['beach_morning_glory',morningGlory],['beach_bean',beachBean],['naupaka',naupaka],['crinum',crinum],['sea_hibiscus',hibiscus]]);
  function mesh(key, draw) {
    if (!cache.has(key)) cache.set(key,sculpt(draw));
    if (!material) {
      material = new THREE.MeshStandardMaterial({vertexColors:true, side:THREE.DoubleSide, roughness:.84});
      material.userData.shared = true;
    }
    const m = new THREE.Mesh(cache.get(key),material); m.receiveShadow = true; m.userData.noShadow = true; return m;
  }
  function build(kind, stage) {
    const root = new THREE.Group(); root.name = 'window-garden-model'; root.add(mesh('pot',clay));
    stage = Math.max(0,Math.min(5,Math.trunc(stage) || 0));
    if (kinds.has(kind) && stage) {
      const lily = kind === 'crinum', key = stage < 3 ? (lily ? 'blade' : 'sprout') : kind;
      const leaves = mesh(key+':'+stage, g => stage < 3 ? seedling(g,stage,lily) : kinds.get(kind)(g,stage));
      leaves.name = 'garden-foliage'; leaves.position.y = SOIL/100; root.add(leaves);
    }
    return root;
  }
  V3.gardenModels = { build };
})(window.V3);
