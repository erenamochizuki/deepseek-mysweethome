// Small, original two-ink illustrations. The flat ink follows the actual paper, tin or glass surface.
// No image files, web fonts or network access; every print and its geometry are cached per SKU.
(function (A) {
  'use strict';
  const stocks={
    blueberry:['BERRIES','#e9d09d','#244d61','#545383'],cake:['FRAISE','#f9dcc4','#a34155','#ce485b'],
    chips:['CRISPS','#cb503a','#ffdd96','#223e48'],nori:['NORI','#245950','#e8c885','#163b40'],
    bread:['MILK ROLLS','#dbaf78','#583927','#ad6a3e'],marshmallow:['MALLOW','#df94aa','#703650','#e57791'],
    fish_cracker:['LITTLE FISH','#e4c891','#20475a','#bb693e'],cookie:['BISCUITS','#ecd3a6','#583240','#ac6242'],
    milk:['MILK','#f1e4c4','#31566e','#6b9ea5'],honey:['HONEY','#f5dba6','#704124','#cb873a'],
    lemonade:['SODA','#f1dc93','#28594c','#f0ad35'],cocoa:['COCOA','#f4dcc1','#4f7473','#bd7751'],
    pudding:['CUSTARD','#f2d6a0','#84492d','#b88446'],onigiri:['MUSUBI','#f2e2be','#304f49','#c95a4d']};
  const TAU=Math.PI*2, mats=new Map(), surfaces=new Map();
  function print(sku,kind) {
    const key=sku+':'+kind;if(mats.has(key))return mats.get(key);
    const [title,paper,ink,accent]=stocks[sku], tall=kind==='pouch', tin=kind==='tin';
    const W=512,H=tall?640:tin?384:240, cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const c=cv.getContext('2d');
    const fill=(col)=>{c.fillStyle=col;c.fill();};
    function path(d,col){c.fillStyle=col;c.fill(new Path2D(d));}
    function disk(x,y,r,col){c.beginPath();c.arc(x,y,r,0,TAU);fill(col);}
    function stroke(d,col,w=2){c.strokeStyle=col;c.lineWidth=w;c.lineCap='round';c.lineJoin='round';c.stroke(new Path2D(d));}
    function text(t,y,size,col,font='Georgia',weight='bold'){c.font=`${weight} ${size}px ${font}`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=col;c.fillText(t,256,y,448);}
    // Pictograms share a hand-cut silhouette and a restrained second ink; no fonts used for symbols.
    function mark(x,y,s){c.save();c.translate(x,y);c.scale(s,s);
      if(sku==='fish_cracker'||sku==='cocoa'){
        path('M-70 0 Q-40 -38 9 -27 Q40 -23 53 -6 L83 -26 Q78 -6 83 20 L52 7 Q23 33 -15 28 Q-52 25 -70 0Z',ink);disk(-43,-5,4.6,paper);stroke('M-22 -19 Q-7 0 -23 18',paper,3);
        for(let j=0;j<2;j++)for(let i=0;i<3;i++)stroke(`M${i*12-6} ${j*13-13} q8 5 0 10`,paper,2.6);
      } else if(sku==='blueberry'){for(const [x,y] of [[-20,7],[13,13],[1,-13]]){disk(x,y,16,ink);disk(x-3,y-4,4,paper);}path('M0 -19 Q-20 -39 -37 -24 Q-21 -17 0 -19',accent);
      } else if(sku==='cake'){path('M-36 -12 Q-36 -36 -5 -28 Q19 -40 34 -19 Q43 2 5 38 Q0 43 -6 36 Q-32 12 -36 -12Z',accent);path('M-3 -24 l-18 -14 20 6 11 -17 1 17 20 -4 -20 13Z',ink);for(const [x,y] of [[-19,-9],[1,-11],[19,-5],[-10,7],[8,12],[0,25]])disk(x,y,2.6,paper);
      } else if(sku==='chips'){
        for(const [x,y,r,co] of [[-30,-10,-.5,'#bd7535'],[20,9,.32,'#e7a443']]){c.save();c.translate(x,y);c.rotate(r);path('M-47 10 Q-54 -18 -20 -36 Q10 -52 37 -35 Q62 -10 35 17 Q9 52 -24 39 Q-42 31 -47 10Z',co);for(const z of [-22,-5,13,29])stroke(`M${z-10} -25 Q${z+11} -8 ${z} 23`,'#ffdfa0',3);c.restore();}
      } else if(sku==='nori'){for(const [x,y,r,co] of [[-18,-4,-.35,accent],[14,0,.13,'#456851']]){c.save();c.translate(x,y);c.rotate(r);path('M-33 -43 L30 -40 35 39 -31 45Z',co);for(const x of [-16,0,16])stroke(`M${x} -26 q-7 8 1 15 t1 16 t0 16`,'#aeb381',2.8);c.restore();}
      } else if(sku==='marshmallow'){c.rotate(-.28);path('M-36 -36 Q-5 -50 30 -36 Q38 -32 36 -22 L34 32 Q0 48 -34 33Z',accent);stroke('M-33 -20 Q0 -7 34 -24 M-34 17 Q4 3 33 -14 M-21 36 Q14 19 35 20','#ffedcf',8);
      } else if(sku==='bread'){path('M-71 15 Q-74 -17 -35 -31 Q13 -50 54 -24 Q75 -10 69 12 Q63 34 13 36 Q-50 41 -71 15Z',ink);for(const x of [-33,0,33])stroke(`M${x-8} -20 q17 5 16 28`,paper,7);
      } else if(sku==='cookie'){disk(0,0,42,accent);for(const [x,y,r] of [[-15,-18,6],[14,-19,5],[3,5,7],[-21,13,5],[18,19,5]]){c.save();c.translate(x,y);c.rotate(x);c.fillStyle=ink;c.fillRect(-r,-r,r*2,r*1.6);c.restore();}
      } else if(sku==='milk'){path('M0 -36 C-8 -15 -29 -3 -29 13 A29 27 0 0 0 29 13 C29 -3 9 -17 0 -36Z',ink);stroke('M-14 11 q-2 10 9 12',paper,3.7);
      } else if(sku==='lemonade'){disk(0,0,36,ink);disk(0,0,32,accent);for(let i=0;i<8;i++){const a=TAU*i/8;stroke(`M0 0 L${29*Math.cos(a)} ${29*Math.sin(a)}`,paper,3);}path('M17 -30 Q21 -52 46 -48 Q39 -33 17 -30Z',ink);
      } else if(sku==='honey'){for(const [x,y] of [[-17,8],[17,8],[0,-20]]){c.beginPath();for(let i=0;i<6;i++){const a=(i+.5)*TAU/6;c[i?'lineTo':'moveTo'](x+18*Math.cos(a),y+18*Math.sin(a));}c.closePath();c.strokeStyle=ink;c.lineWidth=4;c.stroke();}
      } else if(sku==='onigiri'){path('M-36 19 L-6 -28 Q0 -35 6 -28 L36 19 Q42 30 28 30 H-28 Q-42 30 -36 19Z',ink);c.fillStyle=paper;c.fillRect(-10,9,20,21);
      } else {path('M-31 18 l8 -43 q22 -8 46 0 l8 43 q-30 13 -62 0Z',accent);stroke('M-30 18 Q0 26 30 18',ink,4);}c.restore();}
    c.fillStyle=paper;c.fillRect(0,0,W,H);
    if(tall){
      const light=sku==='chips'?'#f8d07c':sku==='nori'?'#a8bd95':sku==='bread'?'#f8db9b':'#fae2c9';
      c.fillStyle=light;c.beginPath();c.ellipse(256,252,155,139,0,0,TAU);c.fill();
      for(const y of [16,25,578,589]){c.fillStyle=ink;c.fillRect(0,y,W,y===16?4:2);}
      text('T I D E   •   S U P P L Y',76,23,ink,'Arial');mark(256,250,1.66);
      for(const x of [58,454]){disk(x,242,5,ink);disk(x,264,2.5,ink);}
      text(title,447,sku==='bread'?71:90,ink);text(({chips:'SEA SALT',nori:'SEA GREENS',bread:'DAILY BAKED',marshmallow:'VANILLA SWIRL'})[sku],507,23,ink,'Arial');
      for(let i=0;i<12;i++)stroke(`M${i*48-28} 554 q12 -12 24 0 t24 0`,ink,3);
    } else if(tin){
      c.strokeStyle=ink;c.lineWidth=4;c.strokeRect(11,10,490,364);c.lineWidth=2;c.strokeRect(19,18,474,348);
      if(sku==='fish_cracker')for(const x of [35,373])for(const y of [150,170,190])stroke(`M${x} ${y} q10 -8 20 0 t20 0 t20 0 t20 0 t20 0`,accent,2.6);
      text('T I D E   P R O V I S I O N S',62,21,ink,'Arial');mark(256,167,sku==='cookie'?1.4:1.15);text(title,267,61,ink);text(sku==='cookie'?'B U T T E R   &   C O C O A':'S E A S I D E   B A K E R Y',324,16,ink,'Arial');
      for(const x of [60,452]) for(const y of [125,201]){c.save();c.translate(x,y);path('M0 -9 L3 -2 10 0 3 3 0 10 -2 3 -10 0 -3 -2Z',accent);c.restore();}
    } else {
      c.fillStyle=ink;c.fillRect(0,5,W,5);c.fillRect(0,230,W,5);
      mark(256,65,.75);text(title,141,sku==='blueberry'?82:85,ink);text('T I D E    P R O V I S I O N S',204,17,ink,'Arial');
      for(const x of [103,409]){disk(x,64,4,accent);stroke(`M${x-23} 64 h14 m18 0 h14`,accent,2);}
    }
    const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;tex.userData.shared=true;
    const mat=new THREE.MeshStandardMaterial({map:tex,roughness:.76});mat.userData.shared=true;mats.set(key,mat);return mat;
  }
  // Surface coordinates are millimetres; v=0 is the bottom of the artwork. Orient the grid outwards.
  A.ink=function(sku,kind,surface,nx=1,ny=1){
    const key=sku+':'+kind;let geo=surfaces.get(key);
    if(!geo){const pos=[],uv=[],ix=[];for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const u=i/nx,v=j/ny;pos.push(...surface(u,v).map(x=>x*.001));uv.push(u,v);}
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;ix.push(a,a+1,a+nx+2,a,a+nx+2,a+nx+1);}geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();geo.userData.shared=true;surfaces.set(key,geo);}
    const m=new THREE.Mesh(geo,print(sku,kind));m.name='snack-print:'+sku;return m;
  };
})(window.V3.snackArt);
