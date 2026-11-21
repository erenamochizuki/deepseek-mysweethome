// 取景只考虑地平线上的真实节点。在当前视野里放得下时，保留玩家的镜头。
(function (V3) {
  'use strict';
  const D=Math.PI/180, clamp=THREE.MathUtils.clamp;
  const turn=(from,to)=>((to-from)%360+540)%360-180;
  function plane(az,alt) {
    const a=Math.sin(az*D), b=Math.cos(az*D), s=Math.sin(alt*D), c=Math.cos(alt*D);
    return v=>{
      const ahead=a*v.x-b*v.z, z=c*ahead+s*v.y;
      return z>.025 ? {x:(b*v.x+a*v.z)/z,y:(s*ahead-c*v.y)/z} : null;
    };
  }
  function fit(stars,pose,w,h,safe,blocks) {
    if(!stars.length) return null;
    const lens=h/2/Math.tan(pose.fov*D/2), initial=plane(pose.az,pose.alt);
    if(stars.every(v=>{
      const p=initial(v);if(!p)return false;
      const x=w/2+lens*p.x,y=h/2+lens*p.y;
      return x>=9 && x<=w-9 && y>=9 && y<=h-9 && !blocks.some(b=>x>b.left-7 && x<b.right+7 && y>b.top-7 && y<b.bottom+7);
    })) return null;
    let best=null;
    // 用节点投影的四个极值约束焦距；优先保住放大倍率，再把轮廓移到可用区域中央。
    function sample(az,alt) {
      const project=plane(az,alt);let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const v of stars) {
        const p=project(v);if(!p)return;
        left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
      }
      let lo=h/2/Math.tan(83*D),hi=lens;
      for(const [factor,bound] of [[-left,w/2-safe.left],[right,safe.right-w/2],[-top,h/2-safe.top],[bottom,safe.bottom-h/2]]) {
        if(factor>0) hi=Math.min(hi,bound/factor);
        else if(factor<0) lo=Math.max(lo,bound/factor);
        else if(bound<0) return;
      }
      if(hi<lo)return;
      const offsetX=(w+hi*(left+right)-safe.left-safe.right)/w;
      const offsetY=(h+hi*(top+bottom)-safe.top-safe.bottom)/h;
      const score=2*Math.log(lens/hi)+Math.hypot(offsetX,offsetY)+.006*Math.abs(turn(pose.az,az))/180;
      if(!best || score<best.score) best={az,alt,fov:2*Math.atan(h/(2*hi))/D,score};
    }
    const mean=stars.reduce((v,s)=>v.add(s),new THREE.Vector3()).normalize();
    sample(Math.atan2(mean.x,-mean.z)/D,Math.asin(clamp(mean.y,-1,1))/D);
    for(let alt=0;alt<=90;alt+=10) for(let az=0;az<360;az+=15) sample(az,alt);
    for(const step of [4,1,.25]) {
      if(!best) break;
      const center=best;
      for(let x=-3;x<=3;x++) for(let y=-3;y<=3;y++) sample(center.az+x*step,clamp(center.alt+y*step,0,89.8));
    }
    return best;
  }
  V3.starFraming={fit,turn,plane};
})(window.V3);
