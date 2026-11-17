// Snack workshop: draw in millimetres, bake once into the cabin's shared vertex-colour meshes.
(function (V3) {
  'use strict';
  const A = V3.snackArt = {}, TAU = Math.PI * 2;
  const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const ring = (n, fn) => seq(n, i => fn(TAU * i / n, i));
  const mix = (a, b, t) => V3.shellKit.mix(a, b, t);
  const hash = (i, j = 0) => V3.util.hash3(i, j, 917);
  // Nested shapes transform coordinates before baking, so an entire fruit basket is one draw.
  function place(g, x, y, z, scale = 1, yaw = 0) {
    const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
    const f = p => [x + c*p[0] + s*p[2], y + scale*p[1], z - s*p[0] + c*p[2]];
    const dir = p => p && [c*p[0] + s*p[2], scale*p[1], -s*p[0] + c*p[2]];
    return { tri: (a,b,d,col,n) => g.tri(f(a),f(b),f(d),col,dir(n)), quad: (a,b,d,e,col,n) => g.quad(f(a),f(b),f(d),f(e),col,dir(n)),
      loft: (rows, paint, o) => g.loft(rows.map(row => row.map(f)), paint, o),
      beam: (a,b,ra,rb,col,n) => g.beam(f(a),f(b),ra*scale,rb*scale,col,n),
      add: (geo,col) => g.add(geo.scale(scale,scale,scale).rotateY(yaw).translate(x,y,z), col) };
  }
  // Horizontal profile rows [height, radiusX, radiusZ?, offsetX?, offsetZ?].
  function profile(g, rows, n, paint, warp, options) {
    const rows3 = rows.map(([y,x,z=x,cx=0,cz=0],j) => ring(n,(a,i)=>{
      const p=[cx+x*Math.cos(a),y,cz+z*Math.sin(a)]; return warp ? warp(p,a,i,j) : p;
    }));
    g.loft(rows3, typeof paint==='function'?paint:()=>paint, options);
  }
  function oval(g,x,y,z,rx,ry,rz,col,tilt=0,yaw=0,n=12) {
    g.add(new THREE.SphereGeometry(1,n,7).scale(rx,ry,rz).rotateZ(tilt).rotateY(yaw).translate(x,y,z),col);
  }
  function roundedRing(w,d,r,y) {
    return seq(4,k=>seq(4,i=>{const a=(k+i/3)*Math.PI/2;return [(k===0||k===3?1:-1)*(w/2-r)+r*Math.cos(a),y,(k<2?1:-1)*(d/2-r)+r*Math.sin(a)];})).flat();
  }
  function slab(g,w,d,h,y,r,col,bevel=1.2) {
    const b=Math.min(bevel,h*0.35,r*.6);
    g.loft([roundedRing(w-2*b,d-2*b,r-b,y),roundedRing(w,d,r,y+b),roundedRing(w,d,r,y+h-b),roundedRing(w-2*b,d-2*b,r-b,y+h)],()=>col);
  }
  function leaf(g,x,y,z,len,w,yaw,col=0x42795b) {
    const h=place(g,x,y,z,1,yaw); const a=[0,0,0],b=[-w,1,len*.52],c=[0,2.6,len],d=[w,1,len*.48],m=[0,3.1,len*.49];
    h.tri(a,b,m,col,[0,1,0]);h.tri(b,c,m,col,[0,1,0]);h.tri(c,d,m,mix(col,0xf3eb9c,.18),[0,1,0]);h.tri(d,a,m,mix(col,0xf3eb9c,.18),[0,1,0]);
  }
  function line(g,pts,r,col,n=6) { for(let i=1;i<pts.length;i++) g.beam(pts[i-1],pts[i],r,r,col,n); }
  Object.assign(A,{TAU,seq,ring,mix,hash,place,profile,oval,roundedRing,slab,leaf,line});
})(window.V3);
