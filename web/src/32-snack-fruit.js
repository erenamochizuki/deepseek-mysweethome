(function (art) {
  'use strict';
  const {TAU, seq, ring, mix, hash, profile, place, leaf, line, roundedRing} = art;
  function strawberry(mesh) {
    const rows = [[0,2.1],[2.5,5.4],[7,9.1],[13,11.5],[18,11.1],[21.7,8.6],[23,4.2]];
    profile(mesh,rows,20,(band,side)=>mix(0xb82743,0xf15552,.28+.19*Math.sin(side*TAU/20)+.048*Math.max(0,band)+hash(side,band)*.05));
    for (const [band,count] of [[1,7],[2,10],[3,11],[4,9]]) {
      const [low,bottom]=rows[band], [high,top]=rows[band+1], height=(low+high)/2, radius=(bottom+top)/2+.10;
      for (let seed=0;seed<count;seed++) {
        const angle=TAU*(seed+band*.46)/count, cos=Math.cos(angle), sin=Math.sin(angle), slope=(top-bottom)/(high-low);
        const point=(offset,rise)=>[(radius+rise*slope)*cos-offset*sin,height+rise,(radius+rise*slope)*sin+offset*cos];
        mesh.quad(point(0,1.05),point(.48,.15),point(.06,-.82),point(-.48,.15),0xffcf83,[cos,0,sin]);
      }
    }
    for(let tip=0;tip<6;tip++) leaf(mesh,0,22.4,0,9.3+tip%2,2.15,TAU*tip/6,tip%2?0x407b4d:0x53864b);
    mesh.beam([0,22.5,0],[1.8,27,1.1],1.2,.7,0x436b3f,7);
  }
  function mandarin(mesh) {
    const sections=seq(17,index=>{
      const step=index/16, fullness=Math.sin(Math.PI*step)**.77, along=(step-.5)*31;
      const width=.22+6.5*fullness, bottom=10.3-10.3*fullness, top=10.8+2.3*fullness, height=top-bottom;
      return [[0,top],[width*.62,top-height*.12],[width,top-height*.43],[width*.8,bottom+height*.16],[width*.32,bottom],[-width*.32,bottom],[-width*.8,bottom+height*.16],[-width,top-height*.43],[-width*.62,top-height*.12]].map(([depth,rise])=>[along,rise,depth]);
    });
    mesh.loft(sections,(band,facet)=>mix(facet===0 || facet===8?0xfba33c:0xe57919,0xffb445,.15+.12*(band%3===0)+hash(band,facet)*.14));
    line(mesh,sections.filter((row,index)=>index%2===0).map(row=>[row[0][0],row[0][1]+.08,0]),.25,0xffdfaa,5);
    for (const index of [4,7,10,13]) {
      const ridge=sections[index][1], flank=sections[index+1][2];
      line(mesh,[[ridge[0],ridge[1],ridge[2]+.15],[flank[0],flank[1]+.7,flank[2]+.14]],.16,0xffcb79,4);
    }
  }
  function apple(mesh) {
    const sections=seq(19,index=>{
      const step=index/18, across=(step-.5)*43, full=Math.sin(Math.PI*step)**.73;
      const depth=1.2+14.2*full, back=-7+1.4*full, front=back+depth, high=2.6+5.5*full;
      return [[back,.5+1.1*(1-full)],[back+depth*.045,high*(.92+.12*full)],[front-depth*.12,high],[front,high*.88],
        [front+depth*.027,high*.58],[front-depth*.015,high*.22],[front-depth*.12,.35],[back+depth*.43,0]].map(([inward,rise])=>[across,rise,inward]);
    });
    mesh.loft(sections,(band,facet)=>band<0 || band===sections.length-1?0xf5d6a1:facet===1?0xf6dcab:facet>=2&&facet<=5?
      mix(0xa62b3c,0xe85c51,.23+.21*Math.sin(band*.83)+hash(band>>1,facet)*.17):0xe7c68f);
  }
  function kiwi(mesh) {
    const sides=28;
    profile(mesh,[[0,15.2,13.3],[.9,16.8,14.8],[6.2,17,15],[7.3,16.4,14.4]],sides,(band,side)=>mix(0x806044,0xaa8454,.22+.30*hash(side,band)),null,{cap1:false});
    const levels=[[16.4,14.4,7.3],[15.6,13.7,7.36],[11.1,9.5,7.54],[4.4,3.1,7.64]];
    const rims=levels.map(([wide,deep,height])=>ring(sides,angle=>[wide*Math.cos(angle),height,deep*Math.sin(angle)]));
    for(let band=0;band<rims.length-1;band++) for(let side=0;side<sides;side++) {
      const next=(side+1)%sides, tint=band===0?0xc2ba68:band===1?mix(0x8fbd43,0xaed05c,hash(side)*.44):(side%2?0xa5c957:0xb6d56a);
      mesh.quad(rims[band][side],rims[band][next],rims[band+1][next],rims[band+1][side],tint,[0,1,0]);
    }
    const core=rims.at(-1);
    for(let index=0;index<sides;index++) mesh.tri([0,7.69,0],core[index],core[(index+1)%sides],0xe6e4a4,[0,1,0]);
    for(let seed=0;seed<22;seed++) {
      const angle=TAU*seed/22, cos=Math.cos(angle), sin=Math.sin(angle), radius=7.2+1.8*(seed%2);
      const point=(out,along)=>[(radius+out)*cos-along*sin,7.78,((radius+out)*sin+along*cos)*.86];
      mesh.quad(point(-1.15,0),point(.32,.59),point(.93,0),point(.32,-.59),0x483d2e,[0,1,0]);
    }
  }
  function watermelon(mesh) {
    const radius=31, halfDepth=5.5, spread=.76, arcs=14;
    const point=(angle,distance,depth)=>[distance*Math.sin(angle),radius-distance*Math.cos(angle),depth];
    const layers=[[31,29.4,0x407649],[29.4,27.7,0x98bc65],[27.7,25.6,0xf0dcac],[25.6,24.4,0xf99a8b],[24.4,0,0xe84f5a]];
    for(let step=0;step<arcs;step++) {
      const from=-spread+spread*2*step/arcs, to=from+spread*2/arcs;
      for(const [outside,inside,color] of layers) for(const face of [-1,1]) {
        const depth=face*halfDepth, normal=[0,0,face];
        if(inside) mesh.quad(point(from,outside,depth),point(to,outside,depth),point(to,inside,depth),point(from,inside,depth),color,normal);
        else mesh.tri(point(from,outside,depth),point(to,outside,depth),point(0,0,depth),mix(color,0xf67771,step%4*.045),normal);
      }
      mesh.quad(point(from,radius,-halfDepth),point(to,radius,-halfDepth),point(to,radius,halfDepth),point(from,radius,halfDepth),step%3===0?0x447b48:0x62924e,[Math.sin(from),-Math.cos(from),0]);
    }
    for(const sign of [-1,1]) for(const [outside,inside,color] of layers) {
      const angle=sign*spread;
      mesh.quad(point(angle,outside,halfDepth),point(angle,inside,halfDepth),point(angle,inside,-halfDepth),point(angle,outside,-halfDepth),mix(color,0xffbb8f,.14),[sign,1,0]);
    }
    for(const face of [-1,1]) for(const [angle,distance] of [[-.41,19.7],[.13,21.4],[.48,16.4],[-.18,12.2]]) {
      const pit=(out,across)=>{const position=point(angle,distance+out,face*(halfDepth+.055));position[0]+=across*Math.cos(angle);position[1]+=across*Math.sin(angle);return position;};
      mesh.quad(pit(-1.55,0),pit(.35,.76),pit(1.17,0),pit(.35,-.76),0x503b38,[0,0,face]);
    }
  }
  function mango(mesh) {
    profile(mesh,[[0,6.2,4.3],[1.3,12.8,8.5],[4.4,19.0,12.4],[6.5,18.4,11.8]],22,(band,side)=>band>=3?0xe49a31:
      mix(0x8f9846,0xde784d,.48+.4*Math.cos(side*TAU/22)));
    for(const row of [-1,0,1]) for(const column of [-1,0,1]) {
      const wide=row===0?10.5:8.0, deep=row===0?8.0:5.8, across=column*(wide+.65), depth=row*7.3, lift=6.6-1.3*Math.abs(row)-.9*Math.abs(column);
      const tile=place(mesh,across,6.1,depth);
      const footprint=(width,length,height,shift)=>roundedRing(width,length,1.05,height).map(([side,rise,end])=>[side+column*shift,rise,end+row*shift]);
      tile.loft([footprint(wide-.7,deep-.6,0,0),footprint(wide,deep,lift-.75,.55),footprint(wide-.8,deep-.75,lift,.65)],
        band=>band===2?mix(0xffbe3d,0xffce5a,.17*(row+1)):band===1?0xffc757:0xe79a2e);
    }
  }
  Object.assign(art.food,{strawberry,mandarin,apple,kiwi,watermelon,mango});
})(window.V3.snackArt);
