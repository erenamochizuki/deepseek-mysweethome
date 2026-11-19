(function (art) {
  'use strict';
  const {TAU, seq, ring, place, profile, oval, line, mix} = art;

  function durian(mesh) {
    const sections=seq(17,index=>{
      const along=index/16, full=.09+.91*Math.sin(Math.PI*along)**.65;
      return ring(16,angle=>[(along-.5)*36,full*(7.4+7.3*Math.sin(angle)),3.8*Math.sin(Math.PI*along)+full*(9.2+.8*Math.sin(3*angle))*Math.cos(angle)]);
    });
    mesh.loft(sections,(band,side)=>mix(0xe9a833,0xffdb6e,.27+.42*(.5+.5*Math.cos(side*TAU/16))+.08*Math.cos(band*.6)));
    line(mesh,sections.slice(2,-2).map(section=>{const [across,rise,depth]=section[3];return [across,rise+.14,depth];}),.42,0xf9ce66);
  }
  function durianHalf(mesh) {
    const sides=26, bands=6;
    const point=(band,side)=>{const slope=.16+band/bands*1.4, angle=TAU*side/sides;
      return [46*Math.sin(slope)*Math.cos(angle),22*(1-Math.cos(slope)),29*Math.sin(slope)*Math.sin(angle)];};
    for(let band=0;band<bands;band++)for(let side=0;side<sides;side++){
      const base=[point(band,side),point(band,side+1),point(band+1,side+1),point(band+1,side)];
      const [across,rise,depth]=point(band+.5,side+.5), angle=TAU*(side+.5)/sides;
      const tip=[across+3.7*Math.cos(angle),Math.max(0,rise-1.3),depth+3.7*Math.sin(angle)];
      base.forEach((corner,index)=>mesh.tri(corner,base[(index+1)%4],tip,[0x879247,0xa5a650,0x77823d,0x63743e][index],[across,-12,depth]));
    }
    profile(mesh,[[20.8,45.8,28.9],[22.4,45.4,28.6],[23.4,42.4,26.5]],sides,band=>band<1?0x8d944e:0xf3e0a4);
    for(const [across,depth,angle,scale] of [[-17,-7,.2,.97],[17,-6,-.2,.94],[0,9,0,1.06]]) durian(place(mesh,across,23.5,depth,scale,angle));
  }
  function driedFish(mesh) {
    const cuts=[[-18,1.3],[-15,4],[-11,5.6],[-5,5.7],[3,4.5],[11,2.4],[15,1.15]];
    const sections=cuts.map(([across,wide])=>ring(16,angle=>[across,2.3+wide*.39*Math.sin(angle)+Math.max(0,across-6)*.13,wide*Math.cos(angle)+.009*across*across]));
    mesh.loft(sections,(band,side)=>Math.cos(TAU*(side+.5)/16)<-.12?0x647476:band<2?0xb99d72:0xd2b886);
    const tail=[[14,3,2],[21,4,-3],[19,4,3],[22,4,8],[14,3.7,4]];
    mesh.loft([tail,tail.map(([across,rise,depth])=>[across,rise+.65,depth])],()=>0xa58456);
    oval(mesh,-13,4.18,1.8,1.6,.7,1.5,0xefdcac);oval(mesh,-13,4.72,1.8,.9,.45,.8,0x3c3b32);
    line(mesh,sections.slice(2,-1).map(section=>section[3]),.36,0xf4e0b7);
    for(const across of [-7,-2,3,8]) mesh.beam([across,4.6,-.1],[across+2,4.2,1.9],.26,.18,0xb29468,5);
  }
  function berryStar(mesh) {
    const outline=(radius,height)=>ring(10,(angle,index)=>{const reach=index%2?radius*.49:radius;return [reach*Math.sin(angle),height,reach*Math.cos(angle)];});
    mesh.loft([outline(15,0),outline(16.2,1.2),outline(16,5.4),outline(14.9,6.5)],band=>band>=2?0xe7b56e:0xbb8146);
    profile(mesh,[[6.48,5.7],[7.15,5.4],[7.9,4.6],[8.25,3.2]],18,band=>band<=0?0x943856:0xb93862);
    oval(mesh,-1.6,8.19,1.2,1.2,.2,.56,0xef97a7);
    for(let tip=0;tip<5;tip++){const angle=tip*TAU/5;oval(mesh,9*Math.sin(angle),6.54,9*Math.cos(angle),.82,.22,.82,0xc28e50);}
  }
  Object.assign(art.food,{durian,dried_fish:driedFish,berry_star:berryStar});
  art.durianHalf=durianHalf;
})(window.V3.snackArt);
