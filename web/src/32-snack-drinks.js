// Four fill states share the same ceramic/glass and labels. The surface, toppings and spoon follow the contents.
(function (A) {
  'use strict';
  const {TAU,seq,ring,place,profile,oval,line,mix,slab}=A;
  const bottles={
    peach_yogurt:{wall:[[0,17],[2,21],[8,25],[50,25],[58,23],[70,15],[81,15],[83,17],[86,17]],fill:[0,18,38,63],liquid:0xeab0b8,cap:0xb9687d,tag:[18,27,1.1]},
    sea_soda:{wall:[[0,14],[3,18],[10,20],[54,20],[66,18],[78,21],[84,19],[94,11],[115,10],[118,13],[123,13]],fill:[0,23,52,87],liquid:0x4ab3c9,cap:0x527f96,tag:[24,24,1.14]},
    milk:{wall:[[0,19],[2,23.5],[5,25],[69,25],[73,24],[81,20],[89,13],[103,12],[105,14],[109,14]],fill:[0,24,53,79],liquid:0xfff1d5,cap:0x6a9fa2,r:25,tag:[30,28,1.10]},
    lemonade:{wall:[[0,15],[3,20],[7,21.5],[71,21.5],[79,20],[87,15],[95,11],[119,9.5],[121,12],[125,12]],fill:[0,25,52,87],liquid:0xc0c84a,cap:0xdca551,r:21.5,tag:[30,28,1.14]},
    honey:{wall:[[0,25],[2,29],[6,32],[49,32],[55,30],[59,25],[62,24],[66,25]],fill:[0,18,35,55],liquid:0xcd771a,cap:0xa46941,r:32,tag:[16,25,1.04]},
  };
  function radius(rows,y){for(let i=1;i<rows.length;i++)if(y<=rows[i][0]){const [a,r]=rows[i-1],[b,s]=rows[i];return r+(s-r)*(y-a)/(b-a);}return rows.at(-1)[1];}
  function bottleStatic(g,sku){const b=bottles[sku],y=b.wall.at(-1)[0],r=b.wall.at(-1)[1],h=sku==='honey'?10:6;
    profile(g,[[0,b.wall[0][1]],[1.8,b.wall[1][1]],[3.4,b.wall[1][1]]],28,0xb6c8b9);
    profile(g,[[y-1,r-.2],[y,r+1],[y+1.4,r+1.8],[y+h,r+1.8],[y+h+1.1,r-.2],[y+h+1.2,r-2.2]],28,(j,i)=>j===2&&i%2?mix(b.cap,0x674b3b,.23):b.cap);
    profile(g,[[y+h+1.25,r*.69],[y+h+1.6,r*.68]],24,sku==='honey'?0xb7724c:sku==='milk'?0xd2d7ac:0xf3c66a);
    if(sku==='honey'){// Gingham cloth cut on a scallop below a copper preserving ring.
      const n=48, rows=[[66,25],[64,28],[60,33],[55,35]];
      const rings=rows.map(([y,r],j)=>ring(n,(a,i)=>[Math.cos(a)*(r+(j>1?1.15*Math.cos(12*a):0)),y-(j===3?2.2*(1+Math.cos(12*a)):0),Math.sin(a)*(r+(j>1?1.15*Math.cos(12*a):0))]));
      // Descending rows: only the lower edge is open so the cloth doesn't cut through the glass.
      g.loft(rings,(j,i)=>j===0?0xe4d0a1:[0xf2dab0,0xd67d5e,0x9e4f3c][(Math.floor(i/3)%2?1:0)+(j===2?1:0)],{cap0:false,cap1:false});
      profile(g,[[63.9,28],[65,28.2],[66,27.6]],36,0x94603c,null,{cap0:false,cap1:false});
    } else {
      // A teal rolled lip and two small glass glints keep an empty bottle legible on pale UI backgrounds.
      const high=y-4, neck=radius(b.wall,high);
      profile(g,[[high-1.6,neck],[high,neck+.55],[high+1.3,neck]],28,0x9bb7ac,null,{cap0:false,cap1:false});
      for(const [a,t] of [[-.59,.75],[.72,.42]]){const low=b.wall.at(-4)[0],h=low+(high-low)*t;
        const pts=seq(7,i=>{const yy=low+(h-low)*i/6,rr=radius(b.wall,yy)+.05;return [Math.sin(a)*rr,yy,Math.cos(a)*rr];});line(g,pts,.48,0xc3d3c7,5);}
    }
    if(sku==='milk')profile(g,[[95,12.4],[97,12.5],[98,12.3]],28,0xb4bb9e,null,{cap0:false,cap1:false});
  }
  function bottleLiquid(g,sku,lv){const b=bottles[sku],y=b.fill[lv];if(!lv)return;
    const rows=[[3,b.wall[1][1]-1.8],...b.wall.filter(p=>p[0]>3&&p[0]<y).map(([h,r])=>[h,r-1.45]),[y,radius(b.wall,y)-1.45],[y+.6,radius(b.wall,y)-2.2]];
    profile(g,rows,28,(j)=> j>=rows.length-2?mix(b.liquid,0xffe9bb,.2):b.liquid);
    if(sku==='lemonade'||sku==='sea_soda')for(let i=0;i<13;i++){const a=i*2.39+.1,h=9+(i*13%(Math.max(3,y-12))),r=radius(b.wall,h)-1.7;oval(g,Math.sin(a)*r,h,Math.cos(a)*r,.8+i%2*.32,1+i%2*.36,.8+i%2*.32,sku==='sea_soda'?0xc6f1ea:0xf9eab2,0,0,7);}
  }
  function glassBody(g,sku){const b=bottles[sku];profile(g,b.wall,28,0xffffff,null,{cap0:false,cap1:false});}
  // A lathed open shell, with outside, lip and inward-facing walls in one continuous profile.
  function pottery(g,rows,n,paint,flute=0){const p=(j,i)=>{const a=TAU*i/n,[y,r]=rows[j],f=r*(1+flute*Math.cos(a*12));return [f*Math.sin(a),y,f*Math.cos(a)];};
    for(let j=0;j<rows.length-1;j++)for(let i=0;i<n;i++)g.quad(p(j,i),p(j,i+1),p(j+1,i+1),p(j+1,i),paint(j,i));
  }
  const mugRows=[[0,.01],[0,21],[2,23],[4,23],[6,27],[11,30],[17,32],[45,33],[51,34.1],[54,34],[55.2,32],[54.5,30.3],[52.5,30],[44,30],[16,28.4],[7,23],[6.6,.01]];
  const mugs={cocoa:[0x558182,0x80aeaa,0x76a4a1],barley_tea:[0x79553c,0xb68257,0x956b46],matcha:[0x66876d,0xa1b997,0x819c7e],osmanthus_oolong:[0x416a64,0x81a8a0,0x628c82]};
  function mug(g,sku){const [foot,body,handle]=mugs[sku];pottery(g,mugRows,32,j=> j<4?0xb98158:j<6?foot:j<8?body:j<=10?0xd9c298:0xf1dbb8);
    const pts=seq(16,i=>{const a=Math.PI*i/15;return [30+21*Math.sin(a),29+15*Math.cos(a),0];});
    g.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),18,4.2,8,false),handle);
    for(const y of [14,44])oval(g,31,y,0,4.1,4.7,5,handle);
    if(sku==='barley_tea') {
      line(g,[[-22,46,15],[-25,56,22],[-26,53,23],[-26,36,23]],.5,0xe1cba5);
      g.quad([-30,36,21],[-23,36,26],[-23,27,26],[-30,27,21],0xdfb65f,[-1,0,1]);
    }
  }
  function teaSurface(mesh,sku,level){
    const height=[0,18,32,48][level], radius=[0,28.65,29.25,30.2][level];
    profile(mesh,[[height-.6,radius],[height,radius-.25],[height+.12,radius-.85]],32,sku==='matcha'?0x829d57:sku==='osmanthus_oolong'?0xb37b38:0xa25f29);
    if(sku==='osmanthus_oolong'){
      const flowers=[[-11,4,.3],[8,-7,.8],[6,12,.1],[-15,-11,.6],[18,3,.9]];
      for(const [across,depth,turn] of flowers.slice(0,level+2)){
        for(let petal=0;petal<4;petal++) {const angle=petal*TAU/4+turn;
          oval(mesh,across+2*Math.cos(angle),height+.52,depth+2*Math.sin(angle),2.1,.46,1.45,0xf6bf46,0,-angle);}
        oval(mesh,across,height+.82,depth,1.12,.48,1.12,0xc68129);
      }
    }
    if(sku==='matcha') {
      const tip=height+.28, size=.56+.14*level;
      const foam=place(mesh,0,tip,0,size,.24);
      for(let row=0;row<5;row++) for(const side of [-1,1]){
        const depth=-12+row*4.2, width=9.4-row*.95;
        foam.quad([0,0,depth+4],[side*width,0,depth-1],[side*(width+.6),0,depth+2],[0,0,depth+7],0xf4e8c3,[0,1,0]);
      }
      line(foam,[[0,.15,-12],[0,.15,13]],.6,0xf6e9c7);
    }
  }
  function cocoa(g,lv){if(!lv)return;const y=[0,18,32,48][lv],r=lv===1?28.65:lv===2?29.25:30.2;
    profile(g,[[y-.7,r],[y,r-.2],[y+.3,r-1.2]],32,0x573124);
    for(const [i,[x,z,a]] of [[-10,5,.25],[7,-9,-.32],[10,7,.38]].entries()){if(i>=lv)break;
      const q=place(g,x,y-.4,z,1,a);slab(q,10,9,6,0,3,0xffe7cf,1.8);}
    const foam=seq(20,i=>{const a=i*.19+.35;return [Math.cos(a)*(r-3),y+.33,Math.sin(a)*(r-3)];});line(g,foam,.48,0xc08b61,5);
  }
  const pudRows=[[0,.1],[0,21],[3,23],[4.5,23],[6,25],[32,31],[35,32.2],[38,32.2],[39,30.5],[38.5,28],[36.5,27.9],[30,27.4],[7,22],[6,18],[6,.1]];
  function ramekin(g){pottery(g,pudRows,48,j=>j<4?0xc88559:j<6?0xe1b782:j<9?0xf4cda0:0xffe4bf,.026);}
  function pudding(g,lv){if(!lv)return;const y=[0,13,23,34.5][lv],r=22+(y-7)*.22;
    profile(g,[[6,20],[8,22],[y-2.1,r],[y,r+.22],[y+.5,r-.7],[y+.6,r-3]],36,j=>j<2?0xf3c37d:j<4?0xba6d3b:0x8f4121);
    if(lv===3){A.cream(place(g,-6,y+.55,-2,.83)); A.leaf(g,-5,y+1,-1,8,2.5,-.85);}
    const col=0xaf855e;g.beam([10,y-2,-8],[18,y+27,-14],1.2,1.8,col,8);oval(g,18.4,y+27.4,-14.2,2.5,3.6,1.7,0xc09167,-.23);
  }
  A.isBottle=sku=>!!bottles[sku];
  A.drinkWare=(g,sku)=>bottles[sku]?bottleStatic(g,sku):mugs[sku]?mug(g,sku):ramekin(g);
  A.drinkContents=(g,sku,lv)=>bottles[sku]?bottleLiquid(g,sku,lv):sku==='cocoa'?cocoa(g,lv):mugs[sku]?teaSurface(g,sku,lv):pudding(g,lv);
  A.drinkGlass=glassBody;
  A.drinkPrint=sku=>{const b=bottles[sku],params=b?b.tag:mugs[sku]?[19,24,.77]:[10,17,.74], [y,h,span]=params;
    return A.ink(sku,'seal',(u,v)=>{const a=(2*u-1)*span,y1=y+h*v;const r=b?radius(b.wall,y1)+.3:mugs[sku]?32.55+(y1-17)/28:25.9+(y1-6)*.233;return [r*Math.sin(a),y1,r*Math.cos(a)];},20,2);};
})(window.V3.snackArt);
