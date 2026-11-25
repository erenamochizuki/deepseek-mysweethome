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
  const remaining=(item,left)=>Math.max(0,Math.min(item.count,left==null?item.count:left|0));
  function piece(sku){const s=catalog().get(sku);if(!s)return null;if(s.pack==='cup')return pack(sku,3);
    const o=group('piece',sku);o.add(sculpt('piece:'+sku,A.food[sku]));return o;}
  function pack(sku,left,openBottle=false){const s=catalog().get(sku);if(!s)return null;const o=group('pack',sku);
    if(s.pack==='cup'){const lv=Math.max(0,Math.min(3,left==null?s.count:left|0));
      o.add(sculpt('ware:'+sku+(openBottle?':open':''),g=>A.drinkWare(g,sku,openBottle),'glazed'));
      if(lv)o.add(sculpt('contents:'+sku+':'+lv,g=>A.drinkContents(g,sku,lv),'glazed'));
      if(A.isBottle(sku))o.add(sculpt('glass:'+sku,g=>A.drinkGlass(g,sku),'glass'));
      o.add(A.drinkPrint(sku));
    }else{const count=remaining(s,left);o.add(sculpt('pack:'+sku+':'+count,mesh=>A.package(mesh,sku,count)),A.packagePrint(sku,count));}
    return o;}
  const held=(sku,left)=>{const s=catalog().get(sku);return s?s.pack==='cup'?pack(sku,left,s.vessel==='bottle'):piece(sku):null;};
  const views={cake:[.41,.62],birthday_cake:[.28,.50],onigiri:[.37,.47],blueberry:[.39,.64],fish_cracker:[.28,.78],cookie:[.27,.81],cocoa:[.3,.66],pudding:[.4,.64],
    strawberry:[.39,.62],mandarin:[.23,.84],apple:[.32,.67],kiwi:[.30,.78],watermelon:[.42,.48],mango:[.35,.73],
    pretzel:[.25,.80],sandwich:[.39,.49],madeleine:[.36,.70],donut:[.31,.76],barley_tea:[.30,.62],matcha:[.36,.73],
    durian:[.36,.50],dried_fish:[.28,.83],berry_star:[.31,.81],osmanthus_oolong:[.33,.78]};
  const pieceViews={cake:[2.68,.49],birthday_cake:[1.70,.44],onigiri:[.45,.42],strawberry:[.38,.38],mandarin:[.40,.46],apple:[.34,.65],kiwi:[.3,.92],watermelon:[.33,.26],mango:[.44,.62]};
  function icon(sku,o={}){const s=catalog().get(sku),I=V3.shellIcons;if(!s||!I)return null;
    const single=o.what==='piece'&&s.pack!=='cup',lv=single?'':remaining(s,o.left), [az,el]=single?(pieceViews[sku]||[.43,.84]):(s.pack==='bag'&&lv<s.count?[.34,.76]:views[sku]||[.34,.37]);
    return I.get(`snack:${sku}:${single?'piece':'pack'}:${lv}`,{size:o.size||96,build:()=>single?piece(sku):pack(sku,lv),view:{az,el}});
  }
  V3.snackModels={pack,piece,held,icon,has:sku=>!!catalog().get(sku)};
})(window.V3);
