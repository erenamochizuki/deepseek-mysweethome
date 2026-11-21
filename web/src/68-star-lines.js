// 描线的时间用天球上的角距离排好；环视、缩放都不会改变笔顺。
(function (V3) {
  'use strict';
  const S=V3.stars, cache=new WeakMap();
  function plan(c) {
    if(cache.has(c)) return cache.get(c);
    const adj=new Map(), nodes=new Map(), edges=[];
    for(const line of c.lines) {
      for(const hr of line) if(!adj.has(hr)) adj.set(hr,new Map());
      for(let i=1;i<line.length;i++) {
        const a=line[i-1], b=line[i];
        if(a===b || adj.get(a).has(b)) continue;
        const length=Math.max(.0001,S.byHR.get(a).v.angleTo(S.byHR.get(b).v));
        adj.get(a).set(b,length); adj.get(b).set(a,length); edges.push({a,b,length});
      }
    }
    // 一条分支到岔口就能点亮下一支。巨蛇等彼此分离的部分，各自从最亮的节点起笔。
    let end=0;
    for(const root of [...adj.keys()].sort((a,b)=>S.byHR.get(a).mag-S.byHR.get(b).mag)) {
      if(nodes.has(root)) continue;
      const pending=new Map([[root,nodes.size ? end+.035 : 0]]);
      while(pending.size) {
        let hr, at=Infinity;
        for(const [id,t] of pending) if(t<at) { hr=id; at=t; }
        pending.delete(hr); nodes.set(hr,at);
        for(const [next,length] of adj.get(hr)) {
          if(!nodes.has(next)) pending.set(next,Math.min(pending.get(next)??Infinity,at+length));
          end=Math.max(end,Math.min(at,nodes.get(next)??at)+length);
        }
      }
    }
    const unit=.86/(end||1);
    for(const [hr,t] of nodes) nodes.set(hr,t*unit);
    for(const e of edges) {
      if(nodes.get(e.b)<nodes.get(e.a)) [e.a,e.b]=[e.b,e.a];
      e.start=nodes.get(e.a); e.end=e.start+e.length*unit;
    }
    const route={nodes,edges}; cache.set(c,route); return route;
  }
  function size(mag) {
    const k=THREE.MathUtils.clamp((6.3-mag)/7,0,1.4);
    return {base:.48+1.65*k*k,lit:2.05+1.65*k,alpha:.22+.72*Math.min(k+.1,1)};
  }
  function trim(a,b,from,to) {
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length<=from+to) return null;
    const span=1-(from+to)/length;
    return {x:a.x+dx*from/length,y:a.y+dy*from/length,dx:dx*span,dy:dy*span};
  }
  // 把字框略微撑大再测相交，给线、亮星和字的笔画都留些夜空。
  function crosses(a,b,x,y,w,h) {
    if(Math.max(a.x,b.x)<x || Math.min(a.x,b.x)>x+w || Math.max(a.y,b.y)<y || Math.min(a.y,b.y)>y+h) return false;
    const dx=b.x-a.x,dy=b.y-a.y;
    return Math.abs((x+w/2-a.x)*dy-(y+h/2-a.y)*dx)<=(w*Math.abs(dy)+h*Math.abs(dx))/2;
  }
  function labelSpot(center,w,h,area,blocks,segments,previous,maxRadius=224) {
    function tryOffset(dx,dy) {
      const x=Math.round(center.x+dx-w/2), y=Math.round(center.y+dy-h/2);
      if(x<8 || y<8 || x+w>area.w-8 || y+h>area.h-8) return null;
      if(blocks.some(r=>x<r.right+5 && x+w>r.left-5 && y<r.bottom+5 && y+h>r.top-5)) return null;
      if(segments.some(([a,b])=>crosses(a,b,x-5,y-5,w+10,h+10))) return null;
      return {x,y,dx,dy};
    }
    if(previous) { const same=tryOffset(previous.dx,previous.dy); if(same) return same; }
    for(let radius=0;radius<=maxRadius;radius+=16) {
      const steps=Math.max(1,Math.ceil(radius*.3));
      for(let i=0;i<steps;i++) {
        const angle=-Math.PI/2+i*Math.PI*2/steps;
        const spot=tryOffset(Math.cos(angle)*radius,Math.sin(angle)*radius);
        if(spot) return spot;
      }
    }
    return null;
  }
  V3.starLines={plan,size,trim,labelSpot};
})(window.V3);
