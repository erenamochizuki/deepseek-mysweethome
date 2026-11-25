// Edible pieces. The very same sculpts are used in her hand and inside open packages.
(function (A) {
  'use strict';
  const {TAU,seq,ring,hash,mix,place,profile,oval,leaf,line}=A;
  function berry(g,c=0x33447f) {
    profile(g,[[0,3],[1,6.2],[4,8.6],[8,9.1],[12,7.8],[14.4,5.5],[15,3.4],[13.9,2]],12,(j,i)=> j>=6?0x303458:mix(c,0xabb4da,(j>3?.13:.025)+hash(i,j)*.07),null,{cap1:false});
    const rim=ring(12,a=>[3.4*Math.cos(a),15,3.4*Math.sin(a)]),well=ring(12,a=>[2*Math.cos(a),13.9,2*Math.sin(a)]);
    rim.forEach((p,i)=>{const k=(i+1)%rim.length;g.quad(p,rim[k],well[k],well[i],0x41416d,[0,1,0]);g.tri([0,13.9,0],well[i],well[k],0x343456,[0,1,0]);});
    const tips=ring(10,(a,i)=>[Math.cos(a)*(i%2?1.6:3.25),14.95+(i%2?0:.5),Math.sin(a)*(i%2?1.6:3.25)]);
    tips.forEach((p,i)=>g.tri([0,14.7,0],p,tips[(i+1)%10],0x323354,[0,1,0]));
  }
  function strawberry(g) {
    profile(g,[[0,3],[1.7,5.7],[5.2,7.1],[9,6.5],[13.2,4.5],[16.8,1.7],[17.3,.6]],12,(j,i)=>mix(0xc92739,0xff614c,Math.min(.75,.07+Math.max(j,0)*.08+hash(i,j)*.10)));
    for(const [y,r,n,off] of [[4,7,8,0],[7.8,6.8,8,.35],[11.6,5.3,6,0],[14.5,3.2,4,.5]]) for(let i=0;i<n;i++){
      const a=TAU*i/n+off;oval(g,r*.99*Math.cos(a),y,r*.99*Math.sin(a),.48,.86,.48,0xffcf89,0,0,6);
    }
  }
  function cream(g,s=1) {
    const q=place(g,0,0,0,s);
    profile(q,[[0,5.6],[1.4,7.3],[3.3,7.6],[5.6,6.5],[8.2,4.5,4.5,.4],[10.2,2.5,2.5,1],[12.4,.3,.3,2.4]],18,0xffefdb,(p,a,i,j)=>{
      const r=Math.hypot(p[0]-(j>3?.5:0),p[2])*(i%3===0?1:.77),t=a+j*.115; return [r*Math.cos(t)+Math.max(j-4,0)*.7,p[1],r*Math.sin(t)]; });
  }
  // Quarter-round layer cake, with a cut strawberry set in the cream on each exposed face.
  function cake(g) {
    const r=32, co=[15,15], edge=a=>[r*Math.cos(a)-co[0],r*Math.sin(a)-co[1]];
    const outline=[[-15,-15],...seq(11,i=>edge(Math.PI*i/20))];
    const rows=[[0,0xf1b86d],[7.8,0xffedce],[13.8,0xe6a45f],[20.6,0xffe4c8],[21.8,0xd94c54],[23.3,0xffeed9],[26.4,0xffefd9]];
    g.loft(rows.map(([y])=>outline.map(([x,z])=>[x,y,z])),j=>rows[Math.max(0,j)][1]);
    for(let k=0;k<2;k++) for(const [t,sz] of [[8,2.3],[20,2.8]]){
      const p=(a,b)=>k?[-15.05,b,-15+a]:[-15+a,b,-15.05];
      const a=p(t-sz,8.5),b=p(t+sz,8.5),c=p(t+sz*.65,10.8),d=p(t,12.2),e=p(t-sz*.65,10.8); const n=k?[-1,0,0]:[0,0,-1];
      g.quad(a,b,c,d,0xea5a62,n);g.tri(a,d,e,0xec6c69,n);
    }
    cream(place(g,-7,26.2,3.7),1.03); strawberry(place(g,3,26.1,-6,.86));
    leaf(g,2,27,-6,9.1,2.5,1.25);leaf(g,1,27,-5,7.6,2.1,2.7);
  }
  // One sixth of the birthday cake, measured from the point of the slice.
  function birthdaySlice(g) {
    const layers = [
      [0,42,0xe4ad72], [7,42,0xffdfc3], [10,42,0xb94d66], [12,42,0xffdfc3],
      [15,42,0xe8b57c], [21,42,0xf3a8aa], [25,43,0xffefd9], [28,42,0xfff1de],
    ];
    const sections = layers.map(([height,radius], layer) => [
      [0,height,0],
      ...seq(13, i => {
        const angle = (i / 12 - .5) * (TAU / 6 - .012);
        const drip = layer === 6 ? 3 * Math.sin(i * Math.PI / 6) ** 2 : 0;
        return [radius * Math.sin(angle), height - drip, radius * Math.cos(angle)];
      }),
    ]);
    g.loft(sections, band => layers[Math.max(0,band)][2]);
    cream(place(g,0,27.8,31),.92);
    oval(g,1.8,37.5,31,4.6,4,4.6,0xc9435c);
    for (const [x,z,tint] of [[-5,19,0xe78289],[8,23,0x80b5b2],[-11,31,0xe8b452]]) {
      oval(g,x,28.5,z,1.4,1.05,1.4,tint,0,0,7);
    }
  }
  function birthdayRound(g,left) {
    const candles = [0xe98298,0x82bbb9,0xe9b75b];
    for (let i = 0; i < left; i++) {
      const slice = place(g,0,0,0,1,(i+1)*TAU/6);
      birthdaySlice(slice);
      if (i % 2 === 0) {
        const wax = place(slice,0,28,15);
        profile(wax,[[0,2.25],[22,2.25]],10,candles[i/2]);
        for (const height of [5,12,19]) {
          profile(wax,[[height,2.33],[height+1.35,2.33]],10,0xffedd9,
            (p,a)=>[p[0],p[1]+1.2*Math.sin(a),p[2]],{cap0:false,cap1:false});
        }
        profile(wax,[[22,.55],[23.7,.5]],6,0x63413a);
        profile(wax,[[23.4,.6],[25.4,2.3],[27.4,2.1],[31,.15,.15,.8]],9,
          band => band < 1 ? 0xf49c40 : 0xffcc67);
      }
    }
  }
  function bread(g) {
    // Split-top milk roll: twin rounded shoulders around an exposed, pale oven score.
    const rows=[[0,18,11],[2.5,24,14],[8,26,16],[13,24,15],[17.5,20,12],[20,13,8],[21,5,3]];
    profile(g,rows,28,(j,i)=>j<1?0xe9b879:j<3?mix(0xe8a05b,0xd58a49,hash(i>>2,j)*.25):mix(0xc16b30,0xd58b40,hash(i>>2,j)*.25));
    for(const x of [-11,1,12]){
      // Project the scoring strips onto the actual dome, including the shoulders.
      const top=(xx,zz)=>{let lo=0,hi=rows.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(Math.hypot(xx/rows[m][1],zz/rows[m][2])<=1)lo=m;else hi=m;}
        let a=0,b=1;for(let i=0;i<9;i++){const t=(a+b)/2,r=rows[lo],s=rows[hi];if(Math.hypot(xx/(r[1]+(s[1]-r[1])*t),zz/(r[2]+(s[2]-r[2])*t))<=1)a=t;else b=t;}return rows[lo][0]+(rows[hi][0]-rows[lo][0])*a;};
      const path=seq(11,i=>{const t=i/10;return [x+(t-.5)*8,0,(t-.5)*19];});
      for(let i=0;i<10;i++){ const w=t=>.12+2.15*Math.sin(t*Math.PI);const p=(j,k)=>{const xx=path[j][0]+k*w(j/10),z=path[j][2];return [xx,top(xx,z)+.53,z];};
        g.quad(p(i,-1),p(i,1),p(i+1,1),p(i+1,-1),i<6?0xffdc9b:0xfbc480,[0,1,0]); }
    }
  }
  function cookie(g) {
    const boundary=ring(22,(a,i)=>20*(.96+.07*hash(i)));
    profile(g,[[0,.86],[1.6,.98],[4.5,1],[7.2,.90],[8.2,.68],[8.8,.36]],22,(j,i)=>mix(j<2?0xbb703c:0xdb9b59,0xf8c27d,hash(i,j)*.23),(p,a,i)=>[p[0]*boundary[i],p[1],p[2]*boundary[i]]);
    for(const [x,z,r,ang] of [[-9,6,3,.5],[5,10,2.8,2],[8,-5,3.6,.4],[-4,-9,3.1,1.9],[-2,0,2.3,1],[-14,-3,1.6,2],[13,3,1.5,2]]){
      const y=8.5-.9*Math.hypot(x,z)/15;
      profile(place(g,x,y-.5,z,1,ang),[[0,r,r*.83],[1.6,r*.92,r*.73],[2.7,r*.55,r*.5,.5]],5,(j,i)=>i%3===0?0x613b35:0x49312f);
    }
  }
  function marshmallow(g) {
    const tints=[0xe47891,0xffe4d4,0xf0b16e,0xffeed8];
    const rows=[[0,8],[1.4,10.4],[4,11.6],[9,11.9],[15,12],[21,11.9],[26,11.5],[29,10.2],[30,8.2]];
    profile(g,rows,32,(j,i)=>tints[Math.floor(i/8)],(p,a,i,j)=>{const t=a+j*.24,r=Math.hypot(p[0],p[2])*(.86+.14*Math.cos(a*4-.4));return [r*Math.cos(t),p[1],r*Math.sin(t)];});
  }
  function nori(g) {
    const nx=10,nz=8, pt=(i,j,b=0)=>{const x=(i/nx-.5)*45,z=(j/nz-.5)*33; return [x+1.15*Math.sin(j*2.4+i),2.8+b+1.25*Math.sin(i*2.6+j*.9)+.85*Math.cos(j*2.2)+1.5*(i/nx)**3,z+.9*Math.sin(i*1.8+j*2.3)];};
    for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
      const col=mix(0x19392f,0x3f5339,hash(i,j)*.62),a=pt(i,j),b=pt(i+1,j),c=pt(i+1,j+1),d=pt(i,j+1);
      g.quad(a,b,c,d,[col,mix(col,0x7a8660,.07)],[0,1,0]);g.quad(pt(i,j,-.7),pt(i+1,j,-.7),pt(i+1,j+1,-.7),pt(i,j+1,-.7),0x253e38,[0,-1,0]);
      if((i+j*2)%13===4) oval(g,a[0]+1,a[1]+1.2,a[2],1.6,.46,.72,0xeacb96,0,i*.85,6);
    }
  }
  function chips(g) {
    const nx=12,nz=14,pt=(i,j,b=0)=>{const a=(i/nx-.5)*Math.PI, t=(j/nz-.5)*2,x=21*Math.sin(a),z=24*t*(.13+.87*Math.cos(a));return [x,3.7+.014*x*x-.0045*z*z+.8*Math.cos(i*Math.PI)+b,z];};
    for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
      const a=pt(i,j),b=pt(i+1,j),c=pt(i+1,j+1),d=pt(i,j+1), col=mix(i%2?0xeaa74c:0xf5be61,0xffdb8a,hash(i>>1,j>>1)*.28);
      g.quad(a,b,c,d,col,[0,1,0]);g.quad(pt(i,j,-.65),pt(i+1,j,-.65),pt(i+1,j+1,-.65),pt(i,j+1,-.65),0xd49c4d,[0,-1,0]);
      for(const [edge,p,q] of [[i===0,a,d],[i===nx-1,b,c],[j===0,a,b],[j===nz-1,d,c]])if(edge)g.quad(p,q,[q[0],q[1]-.65,q[2]],[p[0],p[1]-.65,p[2]],0xd3984a,[p[0],0,p[2]]);
    }
  }
  function fish(g) {
    const s=new THREE.Shape();s.moveTo(-19,0);s.bezierCurveTo(-18,9,-4,15,7,6);s.lineTo(12,2.8);s.quadraticCurveTo(19,10,23,10);s.quadraticCurveTo(21,3,20.5,0);s.quadraticCurveTo(21,-4,23,-9);s.quadraticCurveTo(17,-8,12,-3);s.bezierCurveTo(2,-12,-12,-13,-19,0);
    g.add(new THREE.ExtrudeGeometry(s,{depth:3.6,bevelEnabled:true,bevelSegments:2,bevelThickness:1.25,bevelSize:1.4,curveSegments:6}).rotateX(-Math.PI/2).translate(0,1.25,0),(n,p)=>p[1]>4.5?0xe9ab5e:0xc6864a);
    oval(g,-11,6.1,-2.1,1.9,.52,1.9,0x865630);line(g,[[-4,6.18,-6.6],[-2.3,6.18,-3],[-2.2,6.18,1],[-4.4,6.18,5]],.6,0xb5783b);
    for(const z of [-4,0,4]) line(g,[[13,6,z*.3],[18.7,6,z]],.55,0xbd8143);
  }
  function onigiri(g) {
    const s=new THREE.Shape();s.moveTo(-17,0);s.quadraticCurveTo(-23,.4,-21,8);s.quadraticCurveTo(-15,22,-5.5,33);s.quadraticCurveTo(0,39,5.5,33);s.quadraticCurveTo(15,22,21,8);s.quadraticCurveTo(23,.4,17,0);s.closePath();
    g.add(new THREE.ExtrudeGeometry(s,{depth:14,bevelThickness:3,bevelSize:2.3,bevelSegments:3,curveSegments:6}).translate(0,2.3,-7),0xffefd9);
    for(const z of [-10.25,10.25]) { const f=(x,y)=>[x,y,z];g.quad(f(-8,2.6),f(8,2.6),f(8.2,17),f(-8.5,16.3),0x203c39,[0,0,z]);for(const x of [-6,-2,4])g.quad(f(x,3).map((v,k)=>k===2?v*1.001:v),[x+.7,3,z*1.001],[x+1.3,15.7,z*1.001],[x+.6,15.7,z*1.001],0x355147,[0,0,z]); }
    for(const [x,y,a] of [[-13,11,.3],[-9,21,-.5],[-3.5,25,1.1],[5,21,.2],[14,9,-.8],[2,31,-.5],[11,17,1],[-15,7,-.5],[-3,20,1.4]]) oval(g,x,y,9.9,1.15,1.9,.45,0xe7d9be,a,0,7);
  }
  A.food={blueberry:berry,cake,bread,cookie,marshmallow,nori,chips,fish_cracker:fish,onigiri};A.cream=cream;A.strawberry=strawberry;
  A.food.birthday_cake = g => birthdaySlice(place(g,0,0,-22));
  A.birthdayRound = birthdayRound;
})(window.V3.snackArt);
