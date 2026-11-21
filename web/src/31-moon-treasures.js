/* Moonlit beach finds. The catalogue scales and caches the baked mesh just like other shells. */
(function (V3) {
  'use strict';
  const T = THREE, tau = Math.PI * 2, v = p => new T.Vector3(...p);
  const mat = (color, roughness = .42, metalness = .06) => new T.MeshStandardMaterial({color, roughness, metalness});
  function mesh(g, geo, m, p = [0,0,0]) {
    const o = new T.Mesh(geo,m); o.position.set(...p); g.add(o); return o;
  }
  function oval(g,p,s,m) {
    const o = mesh(g,new T.SphereGeometry(1,8,5),m,p); o.scale.set(...s); return o;
  }
  function stem(g,points,radii,m) {
    const curve = new T.CatmullRomCurve3(points.map(v)), n = (points.length-1)*4, sides=7;
    const frames=curve.computeFrenetFrames(n,false), pos=[], idx=[];
    for(let i=0;i<=n;i++) {
      const t=i/n, p=curve.getPointAt(t), f=t*(radii.length-1), k=Math.floor(f);
      const r=T.MathUtils.lerp(radii[k],radii[Math.min(k+1,radii.length-1)],f-k);
      for(let j=0;j<sides;j++) {
        const a=tau*j/sides, q=p.clone().addScaledVector(frames.normals[i],r*Math.cos(a)).addScaledVector(frames.binormals[i],r*Math.sin(a)); pos.push(q.x,q.y,q.z);
        if(i<n){const a=i*sides+j,b=i*sides+(j+1)%sides;idx.push(a,b,b+sides,a,b+sides,a+sides);}
      }
    }
    const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(pos,3)); geo.setIndex(idx); geo.computeVertexNormals(); return mesh(g,geo,m);
  }
  function paint(geo,fn) {
    const p=geo.attributes.position, colors=[];
    for(let i=0;i<p.count;i++) colors.push(...fn(p.getX(i),p.getY(i),p.getZ(i)).toArray());
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    return geo;
  }
  const mix=(a,b,t)=>new T.Color(a).lerp(new T.Color(b),Math.max(0,Math.min(1,t)));
  function jadeBranch(g) {
    const bark=mat(0xb1874e,.44,.27), twig=mat(0xc2ad75,.42,.23), jade=mat(0x56b993,.32), jade2=mat(0xa0d8ab,.32);
    const pts=[[0,.04,0],[-.22,.33,.06],[-.11,.69,0],[.17,.98,-.04],[.16,1.29,.05],[.4,1.58,0]];
    stem(g,pts,[.115,.102,.087,.067,.048,.016],bark);
    for(let i=0;i<5;i++){const a=i*tau/5;stem(g,[pts[1],[.27*Math.cos(a)-.09,.14,.22*Math.sin(a)],[.46*Math.cos(a)-.08,.025,.32*Math.sin(a)]],[.073,.065,.009],bark);}
    const branches=[[[pts[2],[-.49,.75,.06],[-.68,.94,.1]],0xe8a1a5],[[pts[3],[.49,1.04,.16],[.67,1.26,.18]],0x77c4c2],[[pts[4],[-.04,1.4,-.14],[-.19,1.57,-.18]],0xbaa2da],[[pts[1],[.06,.49,.26],[.29,.65,.34]],0xe6bc69],[[pts[2],[-.35,.95,-.3],[-.34,1.14,-.37]],0x8bb4d3],[[pts[4],[.34,1.46,.02],pts[5]],0xe7d59b]];
    for(const [i,[path,col]] of branches.entries()) {
      stem(g,path,[.058,.039,.014],twig);const [x,y,z]=path[2], sign=x>0?1:-1;
      stem(g,[[x,y,z],[x+.055*sign,y+.09,z],[x+.12*sign,y+.055,z]],[.024,.017,.009],twig);
      const fruit=mesh(g,new T.IcosahedronGeometry(.105,1),mat(col,.2,.16),[x+.12*sign,y-.025,z]);fruit.scale.y=1.14;
      for(let j=0;j<2;j++) {const p=path[j+1],L=mesh(g,new T.OctahedronGeometry(1),j?jade:jade2,[p[0]+sign*.064,p[1]+.077,p[2]+(j?.025:-.04)]); L.scale.set(.061,.15,.043); L.rotation.z=-sign*(.55+.17*(i%3));L.rotation.x=j?.3:-.8;}
    }
  }
  function dragonPearl(g) {
    const shell=mat(0xffffff,.19,.18);shell.vertexColors=true;
    const geo=paint(new T.SphereGeometry(.62,40,28),(x,y,z)=>{
      const k=Math.sin(7*y+2.8*x+1.8*Math.sin(z*6-x*3)),w=Math.cos(3*x+4*z-y);
      return mix(0x639ca6,0xcac1db,(k+1)*.39+.16).lerp(new T.Color(0xf4e5bb),Math.pow((w+1)/2,5)*.64);
    });mesh(g,geo,shell,[0,.73,0]);
    const bronze=mat(0x7f603b,.35,.35),gold=mat(0xcbac64,.32,.38),scale=mat(0x327c78,.36,.2);
    const path=[],rr=[];
    for(let i=0;i<=24;i++){const t=i/24,a=t*tau*1.12+.35,r=.30+.31*t; path.push([r*Math.cos(a),.105+.51*t*t,r*Math.sin(a)]);rr.push(.10-.047*t);}
    stem(g,path,rr,bronze);
    for(let i=1;i<24;i++){const p=path[i],a=i/24*tau*1.12+.35;const o=mesh(g,new T.OctahedronGeometry(1),i%4===0?gold:scale,[p[0]+.04*Math.cos(a),p[1]+.035,p[2]+.04*Math.sin(a)]);o.scale.set(.10,.079,.116);o.rotation.y=-a;}
    for(let i=0;i<3;i++){const a=.5+i*tau/3; const cp=(r,y,d)=>[r*Math.cos(a+d),y,r*Math.sin(a+d)];stem(g,[cp(.35,.12,0),cp(.52,.28,.07),cp(.59,.47,.18),cp(.61,.66,.26)],[.079,.062,.036,.003],gold);}
  }
  function swallowShell(g) {
    // Two rolled lips form an actual aperture; the dark stripe is recessed between them.
    const geo=new T.SphereGeometry(1,64,44),p=geo.attributes.position,cols=[];
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i), xx=.65*x*(1+.1*z), zz=z*1.01;
      let yy=.30+(y>0?.49:.255)*y;
      if(y<0) yy+=.101*Math.exp(-x*x/.008)*-y;
      p.setXYZ(i,xx,yy,zz);
      const a=Math.abs(x), wing=.11+.72*a-.57*a*a;
      const mark=y>0 && ((a<.86 && Math.abs(z-wing)<(.15*(1-a/.9))) || (a<.10 && z>-.27 && z<.37) || (z<0 && z>-.56 && Math.abs(a+.42*z)<.067*(1+z)));
      let c=mix(0xe6c8a2,0xffecd3,.5+.33*Math.sin(22*z+x*2));
      if(y>0 && Math.abs(Math.abs(z+.03)-(.63+.05*Math.cos(5*x)))<.024)c=new T.Color(0xba9459);
      if(mark)c=mix(0x233b50,0x406270,.5+x*.4);
      if(y<-.45 && a<.052*(1-z*z))c=new T.Color(0x503c44); cols.push(...c.toArray());
    }
    geo.setAttribute('color',new T.Float32BufferAttribute(cols,3));geo.computeVertexNormals();const m=mat(0xffffff,.28);m.vertexColors=true;mesh(g,geo,m);
    const lip=mat(0xf0d7b7,.36);
    for(let i=-8;i<=8;i++)for(const side of [-1,1]){const z=i*.098,w=Math.sqrt(1-z*z); const o=oval(g,[side*.116*w,.30-.255*w+.008,z],[.09*w,.026,.024],lip);o.rotation.y=side*z*.25;}
    g.rotation.y=-.43;
  }
  function stoneBowl(g) {
    const profile=[[.001,.07],[.22,.07],[.25,.035],[.34,.035],[.365,.065],[.35,.136],[.42,.16],[.56,.22],[.68,.34],[.775,.51],[.81,.64],[.803,.68],[.784,.702],[.751,.701],[.731,.67],[.718,.60],[.67,.48],[.57,.35],[.43,.256],[.27,.206],[.08,.196],[.001,.196]];
    const geo=paint(new T.LatheGeometry(profile.map(([r,y])=>new T.Vector2(r,y)),64),(x,y,z)=>{
      const a=Math.atan2(z,x),v=Math.sin(24*y+2.5*Math.sin(2*a)+.8*Math.cos(5*a+y));
      return mix(0x394746,0x627269,.43+.22*Math.sin(11*x+7*z)+.19*v).lerp(new T.Color(0xa5aaa0),Math.max(0,(v-.87)*3.1));
    });const m=mat(0xffffff,.73,.035);m.vertexColors=true;mesh(g,geo,m);
    const worn=mat(0xb39762,.58,.18);
    function rim(r,y,thick){const o=mesh(g,new T.TorusGeometry(r,thick,6,64),worn,[0,y,0]);o.rotation.x=Math.PI/2;}
    rim(.797,.676,.009);rim(.357,.101,.008);
    // A single repaired fissure follows the curvature; no overall gold plating.
    const seam=(r,y,a)=>[r*Math.cos(a),y,r*Math.sin(a)];
    stem(g,[seam(.795,.687,1.42),seam(.809,.64,1.43),seam(.791,.56,1.54),seam(.775,.51,1.52),seam(.73,.43,1.68),seam(.68,.34,1.69),seam(.624,.277,1.78)],[.011,.013,.01,.012,.01,.007,.002],worn);
    stem(g,[seam(.791,.56,1.54),seam(.781,.53,1.68),seam(.762,.49,1.78)],[.008,.007,.002],worn);
  }
  function treasureConch(g) {
    // A logarithmic whorl sweeps away from the aperture; the visible throat follows
    // the same curve back into the body, so the lip reads from the reverse side too.
    const sides=24, steps=103, turns=5.4, roll=.34;
    function point(th,b,wall=1) {
      const s=Math.pow(.56,th/tau), angle=th+roll, c=Math.cos(b), h=Math.sin(b);
      const shoulder=Math.exp(-((h-.47)**2)/.058);
      const knobs=1+.16*shoulder*Math.max(0,Math.cos(8*th+.4))**3;
      const lip=Math.exp(-6*th), wing=1+lip*(.17+.16*Math.max(0,c));
      // The inner flank rolls onto the central column rather than crossing the coil axis.
      const radial=s*(.39+(.53+.24*Math.min(0,c))*wall*c*wing*knobs);
      const beak=lip*Math.max(0,-h)**7;
      return new T.Vector3(-2.5*(1-s)-.79*s*h*wall*wing+.23*beak,
        radial*Math.cos(angle)-.09*beak, -radial*Math.sin(angle)+.18*lip*s*wall+.065*beak);
    }
    const painted=mat(0xffffff);painted.vertexColors=true;
    function surface(rows,pointAt,colorAt,reverse) {
      const pos=[],col=[],idx=[];
      for(let i=0;i<=rows;i++) for(let j=0;j<sides;j++) {
        const t=i/rows,b=tau*j/sides;
        pos.push(...pointAt(t,b).toArray());col.push(...colorAt(t,b).toArray());
        if(i===rows)continue;
        const p=i*sides+j,q=i*sides+(j+1)%sides,a=p+sides,d=q+sides;
        idx.push(...(reverse?[p,d,a,p,q,d]:[p,a,d,p,d,q]));
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));
      geo.setAttribute('color',new T.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(g,geo,painted);
    }
    const end=turns*tau;
    surface(steps,(t,b)=>point(end*t,b),(t,b)=>{
      const th=end*t, band=.5+.5*Math.cos(3*b+.18*Math.sin(7*th));
      const engraved=Math.exp(-((b-.79-.10*Math.sin(th*3))**2)/.032);
      return mix(0x90521f,0xe9ac42,.12+.53*band+.20*Math.cos(8*th+b)).lerp(new T.Color(0x804022),engraved*.80);
    },false);
    surface(2,(t,b)=>point(0,b,1-.105*t),()=>new T.Color(0xffdc85),true);
    surface(15,(t,b)=>point(1.48*t,b,.895*(1-.995*t**1.6)),(t,b)=>mix(0xe6a05c,0x45221a,Math.min(1,t*1.35+.09*Math.cos(b))),true);
    // A narrow rolled edge catches the light around the opening.
    const outline=Array.from({length:sides},(_,j)=>point(0,j*tau/sides,.972));
    mesh(g,new T.TubeGeometry(new T.CatmullRomCurve3(outline,true),48,.026,6,true),mat(0xffcf70));
    // Low bezels follow the local curvature, with a larger garnet on the body whorl.
    const seat=mat(0xb47d32), wire=mat(0xffda82), up=new T.Vector3(0,1,0);
    function jewel(th,b,r,col) {
      const p=point(th,b), tangent=point(th+.002,b).sub(p), across=point(th,b+.002).sub(p), n=tangent.cross(across).normalize();
      const base=new T.Group();g.add(base);base.position.copy(p);base.quaternion.setFromUnitVectors(up,n);base.scale.set(r,r,r*1.22);
      mesh(base,new T.CylinderGeometry(1.03,1.08,.24,12),seat,[0,.02,0]);
      const bezel=mesh(base,new T.TorusGeometry(.92,.112,6,16),wire,[0,.18,0]);bezel.rotation.x=-Math.PI/2;
      const stone=mesh(base,new T.CylinderGeometry(.56,.90,.36,8),mat(col,.18),[0,.29,0]);stone.rotation.y=.18;
    }
    for(const [th,b,r,c] of [[.12,.49,.082,0xb82946],[4.70,.46,.105,0x168883],[5.37,.5,.105,0xa71c45],[6.16,.48,.075,0x315ab0],[10.98,.48,.058,0x208970],[11.75,.48,.046,0x853452]]) jewel(th,b,r,c);
    g.rotation.z=-.20;
  }
  const items = [
    {id:'jade_branch', chime:'stone', name:'矿化流木', weather:['clear'], size:.18, desc:'枯枝覆着暗金矿壳，枝头六颗果子，各有各的颜色。轻轻一晃，听见的却是玉石相碰的声音。', make:jadeBranch},
    {id:'dragon_pearl', chime:'stone', name:'虹光海石', weather:['drizzle','rain','storm'], size:.105, desc:'珠底一圈青鳞，恰好缺了一片。握在手里有些温暖，迎光转动时内里泛出五色微光。', make:dragonPearl},
    {id:'swallow_cowrie', chime:'shell', name:'瓷白宝螺', weather:['snow'], size:.079, desc:'壳口沾着一点旧巢泥。翻过来，背上那双墨色的尾羽，正要从掌心飞走。', make:swallowShell},
    {id:'stone_bowl', chime:'stone', name:'凹面黑石', weather:['fog'], size:.155, desc:'潮水磨成浅碗状的乌石，不生青苔与藤壶，暗处隐约浮着微光。', make:stoneBowl},
    {id:'treasure_shell', chime:'metal', name:'宝藏螺', weather:[], size:.139, desc:'金灿灿的，摸起来有点硌手。拿来压书吧，又怕上面那几颗小石头把纸蹭破了。', make:treasureConch},
  ];

  // First-discovery dates survive sales and identify the collection even after a reset or import.
  const loreSet = ['jade_branch','dragon_pearl','swallow_cowrie','stone_bowl'];
  function collectionKey(found) {
    return loreSet.every(id => found?.[id]) ? loreSet.map(id => found[id].first).join(':') : null;
  }

  // One indexed, vertex-coloured mesh keeps the entire find on the collection turntable
  // and lets existing pattern painters, face tags and the shared geometry cache work unchanged.
  function geometry(make) {
    const root = new T.Group(); make(root); root.updateMatrixWorld(true);
    const positions = [], normals = [], colors = [], indices = [], disposables = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.applyMatrix4(o.matrixWorld), p = geo.attributes.position;
      const base = positions.length / 3, col = geo.attributes.color, tint = o.material.color;
      positions.push(...p.array); normals.push(...geo.attributes.normal.array);
      for (let i = 0; i < p.count; i++) colors.push(tint.r * (col ? col.getX(i) : 1), tint.g * (col ? col.getY(i) : 1), tint.b * (col ? col.getZ(i) : 1));
      for (let i = 0, n = geo.index ? geo.index.count : p.count; i < n; i++) indices.push(base + (geo.index ? geo.index.getX(i) : i));
      geo.dispose(); disposables.add(o.material);
    });
    for (const m of disposables) m.dispose();
    const out = new T.BufferGeometry();
    for (const [key, values] of [['position', positions], ['normal', normals], ['color', colors]]) out.setAttribute(key, new T.Float32BufferAttribute(values, 3));
    out.setIndex(indices); out.addGroup(0, indices.length, 0);
    return out;
  }
  V3.moonTreasures = { items, geometry, collectionKey };
})(window.V3);
