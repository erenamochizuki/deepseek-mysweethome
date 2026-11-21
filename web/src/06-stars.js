// J2000 赤道 → 当日赤道 → 小屋的东、上、南。角度对外用度，date 是 Date 或 UTC 毫秒。
(function (V3) {
  'use strict';
  const D = Math.PI / 180, wrap = a => (a % 360 + 360) % 360;
  const clamp = (v,a,b) => Math.min(b, Math.max(v,a));
  const centuries = date => (+date - Date.UTC(2000,0,1,12)) / (36525*86400000);
  function vector(ra,dec) {
    const a=ra*D, b=dec*D;
    return new THREE.Vector3(Math.cos(a)*Math.cos(b), Math.sin(a)*Math.cos(b), Math.sin(b));
  }
  function frame({lat,lon,date}) {
    const t=centuries(date), arc=t*D/3600, h=(V3.env.astro.gmst(date)+lon)*D;
    const c=Math.cos(h), s=Math.sin(h), p=Math.sin(lat*D), q=Math.cos(lat*D);
    const m=new THREE.Matrix4().set(-s,c,0,0, q*c,q*s,p,0, p*c,p*s,-q,0, 0,0,0,1);
    // IAU 1976 岁差的三个旋转（J2000 起算），同一矩阵作用在所有星和天区上。
    const r=new THREE.Matrix4();
    return m.multiply(r.makeRotationZ(arc*(2306.2181+1.09468*t+.018203*t*t)))
      .multiply(r.makeRotationY(-arc*(2004.3109-.42665*t-.041833*t*t)))
      .multiply(r.makeRotationZ(arc*(2306.2181+.30188*t+.017998*t*t)));
  }
  const labels = {
    15:'壁宿二 Alpheratz',99:'火鸟六 Ankaa',188:'土司空 Diphda',424:'北极星（勾陈一） Polaris',472:'水委一 Achernar',
    617:'娄宿三 Hamal',911:'天囷一 Menkar',936:'大陵五 Algol',1017:'天船三 Mirfak',1457:'毕宿五 Aldebaran',
    1708:'五车二 Capella',1713:'参宿七 Rigel',1790:'参宿五 Bellatrix',1791:'五车五 Elnath',1852:'参宿三 Mintaka',
    1903:'参宿二 Alnilam',1948:'参宿一 Alnitak',2061:'参宿四 Betelgeuse',2326:'老人星 Canopus',2421:'井宿三 Alhena',
    2491:'天狼星 Sirius',2618:'弧矢七 Adhara',2891:'北河二 Castor',2943:'南河三 Procyon',2990:'北河三 Pollux',
    3748:'星宿一 Alphard',3982:'轩辕十四 Regulus',4301:'天枢 Dubhe',4295:'天璇 Merak',4554:'天玑 Phecda',
    4660:'天权 Megrez',4730:'十字架二 Acrux',4763:'十字架一 Gacrux',4905:'玉衡 Alioth',5056:'角宿一 Spica',
    5054:'开阳 Mizar',5191:'摇光 Alkaid',5267:'马腹一 Hadar',5340:'大角星 Arcturus',5459:'南门二 Rigil_Kentaurus',
    5793:'贯索四 Alphecca',6134:'心宿二 Antares',6527:'尾宿八 Shaula',7001:'织女星（织女一） Vega',
    7557:'牛郎星（河鼓二） Altair',7417:'辇道增七 Albireo',7924:'天津四 Deneb',8728:'北落师门 Fomalhaut',8781:'室宿一 Markab',
  };
  const tones=['#afc8ff','#d0deff','#edf2ff','#fff3dd','#ffdfb5','#ffc18e','#ffad81'];
  const bytes=Uint8Array.from(atob(V3.starBytes), c=>c.charCodeAt(0)), data=new DataView(bytes.buffer);
  const catalog=[], byHR=new Map();
  for(let p=0;p<bytes.length;p+=10) {
    const hr=data.getUint16(p,true), ra=data.getUint16(p+2,true)*360/65535, dec=data.getInt16(p+4,true)*90/32767;
    const index=data.getInt16(p+8,true), bv=index===-32768 ? null : index/100;
    const [name,latin]=(labels[hr] || '').split(' ');
    const star={hr,ra,dec,bv,mag:data.getInt16(p+6,true)/100, v:vector(ra,dec),name,latin:latin?.replace('_',' '),
      color:tones[clamp(Math.round(((bv ?? .45)+.3)*3),0,tones.length-1)]};
    catalog.push(star); byHR.set(hr,star);
  }
  const atlas=V3.starAtlas;
  const groups=[
    ['Dipper','北斗七星','Big Dipper',[[4301,4295,4554,4660,4301],[4660,4905,5054,5191]],'斗口两星的连线延长约五倍，就到了北极星附近。'],
    ['Summer','夏季大三角','Summer Triangle',[[7001,7924,7557,7001]],'织女、天津四和牛郎分居银河两岸。'],
    ['Winter','冬季大三角','Winter Triangle',[[2491,2943,2061,2491]],'天狼、南河三和参宿四在冬夜围出一个大三角。'],
    ['Belt','猎户腰带（参宿三星）',"Orion's Belt",[[1852,1903,1948]],'三颗亮星几乎等距排列，像系在猎人腰间的带子。'],
  ].map(([id,name,latin,lines,about])=>({id,name,latin,lines,about}));
  // 沿同一赤经从南天极向北数边界交点。每段先展开到短弧，兼容跨零点和极区。
  function region(ra,dec) {
    for(const con of atlas) for(const ring of con.bounds) {
      let inside=con.id==='Oct';
      for(let i=1;i<ring.length;i++) {
        const [a,b]=ring[i-1], [c,d]=ring[i];
        const dx=wrap(c-a+180)-180, x=wrap(ra-a+180)-180;
        if ((x>=0 && x<dx || x<0 && x>=dx) && b+(d-b)*x/dx<dec) inside=!inside;
      }
      if(inside) return con;
    }
    return null;
  }
  function limit({sunAlt,moonAlt=0,moonIllum=0,wx={}}) {
    if(sunAlt>=-2 || ['overcast','drizzle','rain','storm','snow','fog'].includes(wx.kind)) return -Infinity;
    return 6 - 9*clamp((sunAlt+16)/14,0,1) - 2*moonIllum*Math.max(0,Math.sin(moonAlt*D)) - 2*clamp((wx.cloud||0)-.15,0,1);
  }
  // JPL Approximate Positions, 表 1（1800—2050）。每对是 J2000 值和每世纪增量。
  // 顺序为半长轴、偏心率、轨道倾角、平黄经、近日点经度、升交点经度。
  const elements=[
    [1.00000261,.00000562,.01671123,-.00004392,-.00001531,-.01294668,100.46457166,35999.37244981,102.93768193,.32327364,0,0],
    [.38709927,.00000037,.20563593,.00001906,7.00497902,-.00594749,252.25032350,149472.67411175,77.45779628,.16047689,48.33076593,-.12534081],
    [.72333566,.00000390,.00677672,-.00004107,3.39467605,-.00078890,181.97909950,58517.81538729,131.60246718,.00268329,76.67984255,-.27769418],
    [1.52371034,.00001847,.09339410,.00007882,1.84969142,-.00813131,-4.55343205,19140.30268499,-23.94362959,.44441088,49.55953891,-.29257343],
    [5.20288700,-.00011607,.04838624,-.00013253,1.30439695,-.00183714,34.39644051,3034.74612775,14.72847983,.21252668,100.47390909,.20469106],
    [9.53667594,-.00125060,.05386179,-.00050991,2.48599187,.00193609,49.95424423,1222.49362201,92.59887831,-.41897216,113.66242448,-.28867794],
  ];
  function orbit(row,t) {
    const [a,e,i,l,p,n]=row.filter((_,k)=>k%2===0).map((v,k)=>v+row[2*k+1]*t);
    const m=wrap(l-p)*D; let E=m;
    for(let j=0;j<6;j++) E-=(E-e*Math.sin(E)-m)/(1-e*Math.cos(E));
    const v=new THREE.Vector3(a*(Math.cos(E)-e),a*Math.sqrt(1-e*e)*Math.sin(E),0);
    return v.applyAxisAngle(Z,(p-n)*D).applyAxisAngle(X,i*D).applyAxisAngle(Z,n*D);
  }
  const X=new THREE.Vector3(1,0,0), Z=new THREE.Vector3(0,0,1);
  const planetNames=[['水星','Mercury','#e4d4c4',-.4],['金星','Venus','#fff3cd',-4.1],['火星','Mars','#ffac86',.5],
    ['木星','Jupiter','#ffe2b2',-2.1],['土星','Saturn','#ffedc5',.7]];
  function planets(site) {
    const t=centuries(site.date), earth=orbit(elements[0],t), m=frame(site);
    return planetNames.map(([name,latin,color,mag],i)=>{
      const v=orbit(elements[i+1],t).sub(earth).applyAxisAngle(X,23.43928*D).normalize();
      return horizontal({name,latin,color,mag,v,planet:true},m);
    });
  }
  function horizontal(s,m) {
    const dir=s.v.clone().applyMatrix4(m);
    return {...s,dir,alt:Math.asin(clamp(dir.y,-1,1))/D,az:wrap(Math.atan2(dir.x,-dir.z)/D)};
  }
  function visible(site) {
    const m=frame(site), max=site.sunAlt==null ? 6 : limit(site);
    return catalog.filter(s=>s.mag<=max).map(s=>horizontal(s,m)).concat(planets(site)).filter(s=>s.alt>0 && s.mag<=max);
  }
  V3.stars={catalog,byHR,atlas,groups,region,frame,vector,visible,planets,limit};
})(window.V3);
