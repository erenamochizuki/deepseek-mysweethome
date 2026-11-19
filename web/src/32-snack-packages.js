// Containers in the seaside pantry, in millimetres. Labels are separate so the printed art can follow a curved face.
(function (A) {
  'use strict';
  const {TAU,seq,ring,place,profile,oval,slab,roundedRing,mix,food,leaf}=A;
  const packet={chips:[98,137,44,0xc8533e,0xffcf82],nori:[85,128,23,0x24564d,0xdfc077],bread:[98,117,54,0xc99b64,0x946440],marshmallow:[86,131,47,0xe0a2ac,0xf1ceba]};
  const levels=[0,.067,.16,.31,.66,.82,.92,.966,1],widths=[.92,.94,.91,1,.99,.91,.89,.94,.94],depths=[.12,.14,.67,1,.96,.64,.22,.13,.12];
  const facet=x=>1-.19*Math.abs(x)-.07*Math.max(0,(Math.abs(x)-.63)/.37);
  function bagPoint(sku,u,j,front){const [w,h,d]=packet[sku],x=2*u-1;
    return [x*w*widths[j]/2+(sku==='marshmallow'?Math.sin(j*.45)*1.5:0),h*levels[j],(front?1:-1)*d*.5*depths[j]*facet(x)];}
  // Chart only crosses the planar central panel; the bevels and pleated silver seams remain visible.
  function bag(g,sku){const [w,h,d,base,seam]=packet[sku],n=10;
    for(let j=0;j<levels.length-1;j++)for(let i=0;i<n;i++){
      for(const front of [true,false]){const p=(i,j)=>bagPoint(sku,i/n,j,front);const crimp=j===0||j>=6;
        g.quad(p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1),crimp?mix(base,seam,j===6?.55:.7):base,[0,0,front?1:-1]);}
    }
    for(const i of [0,1])for(let j=0;j<8;j++){const p=(j,f)=>bagPoint(sku,i,j,f);g.quad(p(j,true),p(j,false),p(j+1,false),p(j+1,true),mix(base,0x694f4b,.2),[i?1:-1,0,0]);}
    for(const j of [0,8]){const p=(i,f)=>bagPoint(sku,i,j,f);g.quad(p(0,true),p(1,true),p(1,false),p(0,false),seam,[0,j?1:-1,0]);}
    for(const j of [0,7])for(let i=0;i<25;i++){
      const p=(t,k)=>{const v=bagPoint(sku,t,k,true);v[2]+=.18;return v;};const u=(i+.22)/25;
      g.quad(p(u,j),p(u+.014,j),p(u+.014,j+1),p(u,j+1),mix(base,seam,.91),[0,0,1]);}
    if(sku==='bread'){ // fold-over top with a small bakery clip
      slab(place(g,0,0,0),w*.86,d*.26,4.7,h-3,2.6,0xb78655,1);slab(g,22,d*.30,7.5,h-5.5,2,0x965a3c,.8);}
  }
  function bagPrint(sku){return A.ink(sku,'pouch',(u,v)=>{
    const j=Math.min(4,Math.floor(v*5))+1,t=v*5-(j-1),x=.065+u*.87;
    const a=bagPoint(sku,x,j,true),b=bagPoint(sku,x,j+1,true);return a.map((p,k)=>p+(b[k]-p)*t+(k===2?.38:0));
  },10,5);}
  function punnet(g,left=12){
    const rs=[[0,88,57,8],[3,94,62,8],[30,112,77,10],[34,111,76,10]];
    g.loft(rs.map(([y,w,d,r])=>roundedRing(w,d,r,y)),j=>j<1?0x37635e:0x578b7e);
    slab(g,116,81,6.5,31,9,0x92af87,1.4);
    // Recessed finger slots run down either side of the moulded pulp.
    for(const s of [-1,1]) for(const z of [-21,-7,7,21]){
      g.quad([s*54.1,25,z-1.3],[s*54.1,25,z+1.3],[s*48.3,8,z+1.3],[s*48.3,8,z-1.3],0x375f54,[s,0,0]);}
    const palette=[0x394781,0x33396b,0x49416e,0x364a80];
    const rows=[[-24,-33,1.32],[-25,-12,1.44],[-23,12,1.42],[-24,34,1.27],[-3,-36,1.48],[-3,-12,1.44],[-3,13,1.48],[-1,37,1.35],[18,-35,1.32],[18,-12,1.43],[19,13,1.44],[18,36,1.30]];
    rows.slice(0,left).forEach(([z,x,k],i)=>food.blueberry(place(g,x,35+1.25*Math.sin(i*2),z,k,i),palette[i%4]));
    if(left>4){leaf(g,-32,52,-13,19,5,-1.93);leaf(g,-32,52,-13,16,4.5,-.4);}
  }
  function tray(g,w,d,h,base,trim){slab(g,w-5,d-5,h-1,0,5.5,base);slab(g,w,d,3.5,h-2,6,trim,1);slab(g,w-5,d-5,1.8,h+.4,5.5,0xf1d5aa,.7);}
  function pastry(g,left=4){
    tray(g,106,85,15,0xc76c77,0xefb9a9);
    // Four individual portions on a pleated confectioner's paper.
    for(const [x,z,rot] of [[-22,-19,0],[20,-19,-1.57],[-22,17,1.57],[20,17,3.14]].slice(0,left)) food.cake(place(g,x,17,z,.99,rot));
  }
  function bento(g,left=2){
    tray(g,109,64,18,0x8d5a41,0xbd8b58);
    for(const [x,z,rot] of [[-25,-1,-.13],[23,3,.17]].slice(0,left))food.onigiri(place(g,x,18.5,z,1.02,rot));
    // Pickled plum garnish in a fluted paper cup at the rear.
    const q=place(g,4,18,-20);profile(q,[[0,4],[4.4,8],[5.6,8.2]],12,0xdac3a2);oval(q,0,5,0,5.8,4.7,5.4,0xb64646);leaf(q,0,6,0,7,1.6,1.2);
  }
  function fishTin(g){
    const navy=0x375c67,brass=0xb88c52;slab(g,106,74,32,0,10,navy,2);slab(g,108,76,2.8,1.2,10,brass,.9);
    slab(g,111,79,7.4,27,10,brass,1.5);slab(g,110,78,4,31.5,10,navy,1);slab(g,105,73,1.5,35,9.5,0xe5c68a,.6);
  }
  function cookieTin(g){
    profile(g,[[0,38],[2,44],[5,44],[6,42.7],[29,42.7],[30,45],[34,45.5],[36,45],[37,42.3]],36,j=> j===1||j===5||j>=7?0xc29566:0x8e5556);
    for(let i=0;i<24;i++){const a=TAU*i/24,b=a+.057,p=(a,y)=>[43*Math.sin(a),y,43*Math.cos(a)];g.quad(p(a,7),p(b,7),p(b,28),p(a,28),0xc88676,[Math.sin(a),0,Math.cos(a)]);}
    profile(g,[[36.8,40],[38,40],[38.6,38]],36,0xe7c99f);
  }
  const openTrays={
    durian:{width:104,depth:70,height:13},
    dried_fish:{width:94,depth:52,height:12,columns:2,spacing:43,rowGap:14},
    berry_star:{width:76,depth:73,height:12,columns:2,spacing:34,rowGap:32},
    pretzel:{width:108,depth:84,height:14,columns:2,spacing:48,rowGap:35},
    sandwich:{width:102,depth:46,height:14,columns:2,spacing:46,rowGap:35},
    madeleine:{width:115,depth:72,height:14,columns:3,spacing:36,rowGap:30},
    donut:{width:88,depth:47,height:13,columns:2,spacing:39,rowGap:35},
    strawberry:{width:99,depth:68,height:21,columns:3,spacing:29,rowGap:28},
    mandarin:{width:93,depth:93,height:15,round:true},
    apple:{width:108,depth:65,height:15,columns:2,spacing:47,rowGap:17},
    kiwi:{width:111,depth:73,height:15,columns:3,spacing:34,rowGap:31},
    watermelon:{width:104,depth:61,height:15,columns:2,spacing:46,rowGap:24},
    mango:{width:95,depth:68,height:16,columns:2,spacing:41,rowGap:27},
  };
  const unwrapped={
    nori:{width:106,depth:62,height:10,columns:4,spacing:24,rowGap:24,scale:.48},
    chips:{width:114,depth:66,height:12,columns:5,spacing:21,rowGap:27,scale:.46},
    bread:{width:111,depth:60,height:12,columns:3,spacing:34,rowGap:25,scale:.61},
    marshmallow:{width:100,depth:55,height:12,columns:4,spacing:23,rowGap:24,scale:.85},
    cookie:{width:105,depth:59,height:14,columns:4,spacing:24,rowGap:25,scale:.55},
    fish_cracker:{width:118,depth:49,height:12,columns:5,spacing:22,rowGap:19,scale:.48},
  };
  function openTray(mesh,sku,left) {
    const {width,depth,height,columns,spacing,rowGap,round,scale=1}=openTrays[sku]||unwrapped[sku], item=window.V3.snackCatalog.get(sku);
    const [body,lining]=item.colors, edge=mix(body,lining,.47);
    const contour=(inset,rise)=>round?ring(40,angle=>[(width/2-inset)*Math.cos(angle),rise,(depth/2-inset)*Math.sin(angle)]):
      roundedRing(width-2*inset,depth-2*inset,8-inset*.35,rise);
    const outer=contour(-.65,height), inner=contour(2.7,height), floor=contour(3.5,height-3);
    mesh.loft([contour(3,0),contour(0,2),contour(0,height-2),outer],band=>band<1?mix(body,0x72584a,.16):band===2?edge:body,{cap1:false});
    outer.forEach((point,index)=>{
      const next=(index+1)%outer.length;
      mesh.quad(point,outer[next],inner[next],inner[index],edge,[0,1,0]);
      mesh.quad(inner[index],inner[next],floor[next],floor[index],edge,[-point[0],1,-point[2]]);
      mesh.tri([0,height-3,0],floor[index],floor[next],lining,[0,1,0]);
    });
    const layer=height-2.98;
    if(sku==='durian'){A.durianHalf(place(mesh,0,layer,0),left);return;}
    for(let index=0;index<(left??item.count);index++) {
      if(round) {
        const angle=TAU*index/item.count+.13;
        food[sku](place(mesh,23*Math.cos(angle),layer,23*Math.sin(angle),1,-angle));
      } else {
        const row=Math.floor(index/columns), column=index%columns, across=(column-(columns-1)/2)*spacing;
        const back=(row-(Math.ceil(item.count/columns)-1)/2)*rowGap;
        food[sku](place(mesh,across,layer,back,scale,Math.sin(index*2+.5)*.10));
      }
    }
  }
  function traySeal(sku) {
    const {width,depth,height,round}=openTrays[sku]||unwrapped[sku], labelHeight=height-5;
    return A.ink(sku,'seal',(across,up)=>{
      const left=(across-.5)*labelHeight*2.5, front=round?depth*.5*Math.sqrt(1-(left/(width*.5))**2):depth*.5;
      return [left,2.4+labelHeight*up,front+.35];
    },round?10:1);
  }
  const baked={blueberry:punnet,cake:pastry,onigiri:bento,fish_cracker:fishTin,cookie:cookieTin};
  const showTray=(sku,left)=>openTrays[sku] || (unwrapped[sku] && left<window.V3.snackCatalog.get(sku).count);
  A.package=(g,sku,left)=>showTray(sku,left)?openTray(g,sku,left):packet[sku]?bag(g,sku):baked[sku](g,left);
  A.packagePrint=(sku,left)=>{
    if(showTray(sku,left))return traySeal(sku);
    if(packet[sku])return bagPrint(sku);
    if(sku==='fish_cracker'||sku==='cookie'){const rect=sku==='fish_cracker',w=rect?89:59,d=rect?60:45,y=rect?36.58:38.68;return A.ink(sku,'tin',(u,v)=>[(u-.5)*w,y,(.5-v)*d]);}
    const data={blueberry:[57,22.5,y=>31+Math.max(0,y-3)*.28],cake:[50,12,()=>40.6],onigiri:[49,14,()=>30]};
    const [w,h,depth]=data[sku];return A.ink(sku,'seal',(u,v)=>{const y=3+h*v;return [(u-.5)*w,y,depth(y)+.48];});
  };
})(window.V3.snackArt);
