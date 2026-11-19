(function (art) {
  'use strict';
  const { TAU, seq, oval, mix } = art;

  function pretzel(mesh) {
    const bends = [[-11,5,10],[1,4,2],[9,4,-8],[15,4,-10],[19,4,-5],[18,4,2],[10,4,10],[0,4,14],[-10,4,10],[-18,4,2],[-19,4,-6],[-14,4,-11],[-7,5,-9],[1,8,1],[11,6,10]];
    const rope = new THREE.CatmullRomCurve3(bends.map(point => new THREE.Vector3(...point)));
    mesh.add(new THREE.TubeGeometry(rope,64,3.6,8,false),0xb46c31);
    for (const tip of [bends[0], bends.at(-1)]) oval(mesh,...tip,3.6,3.5,3.6,0xb46c31);
    for (const index of [2,3,5,6,7,9,11,12,13]) {
      const [across,rise,depth] = bends[index];
      mesh.add(new THREE.BoxGeometry(1.7,1.2,1.35).rotateY(index).translate(across,rise+3.5,depth),0xffeed0);
    }
  }
  function sandwich(mesh) {
    const corners = [[-20,10],[20,10],[0,-16]];
    const layer = (bottom,top,scale,side,face) => {
      const ring = height => corners.map(([across,depth]) => [across*scale,height,depth*scale]);
      mesh.loft([ring(bottom),ring(top)],(band,edge) => band === 0 && edge !== 0 ? side : face);
    };
    layer(0,5,1,0xbb753e,0xf7d89d); layer(5,7.1,1.06,0xe2a62d,0xffc748);
    layer(7.1,9.4,.95,0xb7473e,0xcb5946); layer(9.4,11.5,1.04,0x60964e,0x81ac58);
    layer(11.5,17,1,0xbb753e,0xf5d49b);
    for (const [across,depth] of [[-9,4],[4,-6],[7,2],[-2,6]]) oval(mesh,across,17.04,depth,1.2,.15,.85,0xddba7c);
  }
  function madeleine(mesh) {
    const slices=32, rings=7;
    function point(row,side,bottom=false) {
      const along=row/rings, angle=(side/slices-.5)*2.02, ridge=(1+Math.cos(side*Math.PI/2))*.5;
      const radius=(2+25*along)*(1+.043*ridge*along), arch=Math.sin(along*Math.PI);
      return [radius*Math.sin(angle)*.82, bottom?0:1.8+arch*(3.2+3.1*ridge+1.6*Math.cos(angle)), radius*Math.cos(angle)-13];
    }
    for (let row=0;row<rings;row++) for (let side=0;side<slices;side++) {
      const corners=[[row,side],[row,side+1],[row+1,side+1],[row+1,side]];
      const upper=corners.map(([band,rib])=>point(band,rib)), lower=corners.map(([band,rib])=>point(band,rib,true));
      mesh.quad(...upper,mix(0xc78543,0xe7af64,(side%4===0||side%4===3)?.8:.35),[0,1,0]);
      mesh.quad(...lower,0xc48a49,[0,-1,0]);
      const edge=(from,to,normal)=>mesh.quad(upper[from],upper[to],lower[to],lower[from],0xbe8144,normal);
      if (row===0) edge(0,1,[0,0,-1]); if (row===rings-1) edge(2,3,[0,0,1]);
      if (side===0) edge(3,0,[-1,0,0]); if (side===slices-1) edge(1,2,[1,0,0]);
    }
  }
  function donut(mesh) {
    const major=12.5, tube=5.2;
    mesh.add(new THREE.TorusGeometry(major,tube,14,36).rotateX(Math.PI/2).translate(0,tube,0),0xd6924d);
    const point=(angle,phase)=>[(major+(tube+.22)*Math.cos(phase))*Math.cos(angle),tube+(tube+.22)*Math.sin(phase),(major+(tube+.22)*Math.cos(phase))*Math.sin(angle)];
    const rings=seq(9,band=>seq(36,side=>{const angle=side*TAU/36;return point(angle,.16-.29*Math.cos(angle*7)+(Math.PI-.37+.29*Math.cos(angle*7))*band/8);}));
    for (let band=0;band<8;band++) for(let side=0;side<36;side++) {
      const next=(side+1)%36, angle=(side+.5)*TAU/36, phase=(band+.5)*Math.PI/8;
      mesh.quad(rings[band][side],rings[band][next],rings[band+1][next],rings[band+1][side],0x68372d,[Math.cos(phase)*Math.cos(angle),Math.sin(phase),Math.cos(phase)*Math.sin(angle)]);
    }
    const candy=[0xe98599,0xfad36e,0x8fcbb7,0xffebc9];
    for(let index=0;index<19;index++) {
      const angle=index*2.4, radius=major+Math.sin(index*4)*2.3, height=tube+Math.sqrt((tube+.22)**2-(radius-major)**2)+.34;
      mesh.add(new THREE.BoxGeometry(2.5,.75,.83).rotateY(index*.81).translate(radius*Math.cos(angle),height,radius*Math.sin(angle)),candy[index%4]);
    }
  }
  Object.assign(art.food,{pretzel,sandwich,madeleine,donut});
})(window.V3.snackArt);
