// 小店、零食篮、手持道具都从这里取模型。公开接口使用米、底面 y=0、印刷正面朝 +z。
(function (V3) {
  'use strict';
  const A=V3.snackArt, catalog=()=>V3.snackCatalog, geos=new Map(), mats=new Map();
  function material(kind){if(!mats.has(kind)){
    const m=kind==='glass'?new THREE.MeshPhongMaterial({color:0x92bba9,specular:0xffffff,shininess:85,transparent:true,opacity:.35,depthWrite:false}):
      V3.vox.material({roughness:kind==='glazed'?.37:.78});m.name='snack:'+kind;m.userData.shared=true;mats.set(kind,m);}return mats.get(kind);}
  function sculpt(key,draw,finish='matte'){
    if(!geos.has(key)){const g=V3.shellKit.sculpt(draw);g.scale(.001,.001,.001);g.computeBoundingBox();g.computeBoundingSphere();g.userData.shared=true;geos.set(key,g);}
    const m=new THREE.Mesh(geos.get(key),material(finish));m.name='snack:'+key;m.receiveShadow=true;m.castShadow=finish!=='glass';return m;
  }
  function group(type,sku){const g=new THREE.Group();g.name=`snack-${type}:${sku}`;g.userData.snack=sku;return g;}
  function piece(sku){const s=catalog().get(sku);if(!s)return null;if(s.pack==='cup')return pack(sku,3);
    const o=group('piece',sku);o.add(sculpt('piece:'+sku,A.food[sku]));return o;}
  function pack(sku,left){const s=catalog().get(sku);if(!s)return null;const o=group('pack',sku);
    if(s.pack==='cup'){const lv=Math.max(0,Math.min(3,left==null?s.count:left|0));
      o.add(sculpt('ware:'+sku,g=>A.drinkWare(g,sku),'glazed'));
      if(lv)o.add(sculpt('contents:'+sku+':'+lv,g=>A.drinkContents(g,sku,lv),'glazed'));
      if(A.isBottle(sku))o.add(sculpt('glass:'+sku,g=>A.drinkGlass(g,sku),'glass'));
      o.add(A.drinkPrint(sku));
    }else{o.add(sculpt('pack:'+sku,g=>A.package(g,sku)),A.packagePrint(sku));}
    return o;}
  const held=(sku,left)=>{const s=catalog().get(sku);return s?s.pack==='cup'?pack(sku,left):piece(sku):null;};
  const views={cake:[.41,.62],onigiri:[.37,.47],blueberry:[.39,.64],fish_cracker:[.28,.78],cookie:[.27,.81],cocoa:[.3,.66],pudding:[.4,.64]};
  function icon(sku,o={}){const s=catalog().get(sku),I=V3.shellIcons;if(!s||!I)return null;
    const single=o.what==='piece'&&s.pack!=='cup',lv=s.pack==='cup'?Math.max(0,Math.min(3,o.left==null?s.count:o.left|0)):'', [az,el]=single?(sku==='cake'?[2.68,.49]:sku==='onigiri'?[.45,.42]:[.43,.84]):(views[sku]||[.34,.37]);
    return I.get(`snack:${sku}:${single?'piece':'pack'}:${lv}`,{size:o.size||96,build:()=>single?piece(sku):pack(sku,lv),view:{az,el}});
  }
  V3.snackModels={pack,piece,held,icon,has:sku=>!!catalog().get(sku)};
})(window.V3);
