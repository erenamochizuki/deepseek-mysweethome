// Editable Blockbench sources for the tide-tank residents. +Z points towards the mouth.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodePNG } from './girl/glb.mjs';

const folder = new URL('../../models/shore/fish/', import.meta.url);
// Pass a resident id (e.g. `node web/tools/tide-resident-models.mjs islet`) to write only that source.
const only = process.argv[2];
function make(id, colors, sculpt) {
  if (only !== undefined && only !== id) return;
  const source=JSON.parse(readFileSync(new URL('mullet.bbmodel',folder),'utf8'));
  let seq=0;
  const guid=()=>createHash('sha256').update(`${id}:${seq++}`).digest('hex').slice(0,32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
  source.name=source.model_identifier=id; source.elements=[]; source.outliner=[]; source.groups=[];
  const pixels=Buffer.alloc(16*16*4);
  for (let i=0;i<256;i++) {const color=Number.parseInt(colors[(colors.length>16?i:i%16)%colors.length],16);pixels.set([color>>16,(color>>8)&255,color&255,255],i*4);}
  Object.assign(source.textures[0],{name:id+'_palette.png',uuid:guid(),source:'data:image/png;base64,'+encodePNG(16,16,pixels).toString('base64')});
  function group(name,parent,origin=[0,0,0],visibility=true) {const uuid=guid(),node={uuid,children:[]};source.groups.push({uuid,name,origin,visibility});(parent?.children||source.outliner).push(node);return node;}
  function box(node,name,x,y,z,w,h,d,color,rotation) {
    const origin=[x,y,z],dim=[w,h,d],uuid=guid(),round=n=>Math.round(n*1000)/1000;
    source.elements.push({type:'cube',name,uuid,origin,from:origin.map((n,i)=>round(n-dim[i]/2)),to:origin.map((n,i)=>round(n+dim[i]/2)),
      ...(rotation?{rotation}:{}),box_uv:false,faces:Object.fromEntries(['up','down','north','south','east','west'].map(k=>{
        const swatch=typeof color==='number'?color:color[k]??color.side, u=swatch%16, v=Math.floor(swatch/16);
        return [k,{texture:0,uv:[u,v,u+1,v+1]}];
      }))});node.children.push(uuid);
  }
  const root=group('main'), b=(...args)=>box(root,...args);
  function eyes(x,y,z,size) {for(const s of [-1,1]) {b('iris',s*x,y,z,.18,size,size,5);b('pupil',s*(x+.1),y,z+.08,.09,size*.60,size*.60,4);b('glint',s*(x+.16),y+.15*size,z+.24*size,.06,size*.19,size*.18,6);}}
  function fan(z,y,size) {const fin=group('tail',root,[0,y,z]);box(fin,'stock',0,y,z-.48,.85,1.1,1.5,0);for(const s of [-1,1])box(fin,'fan lobe',0,y+s*.6*size,z-1.6*size,.42,.9*size,2.3*size,3,[s*22,0,0]);return fin;}
  sculpt({b,root,group,box,eyes,fan});writeFileSync(new URL(id+'.bbmodel',folder),JSON.stringify(source)+'\n');
}

make('foldsail',['558394','dfa95d','385a71','d58157','273847','eec37b','fff5d7','d1dbcf'],({root,b,group,box,eyes,fan})=>{
  b('hull',0,2.1,0,2.3,2.6,6.8,0);b('keel',0,.87,.1,1.7,.74,5.4,1);b('prow',0,2.1,3.9,1.86,1.51,2.05,0);eyes(1.16,2.67,2.65,.73);fan(-3.4,2.1,.9);
  const sail=group('folding_sail',root,[0,3.2,-2.7]);for(let j=0;j<6;j++){const h=1.1+j*.75;box(sail,'canvas pleat',0,3.24+h/2,-2.56+j*.72,.32,h,.72,j%2?6:7);}
  box(sail,'mast cap',0,8.04,1.03,.38,.34,.78,1);for(const s of [-1,1])b('gold sheer',s*1.17,2.02,0,.12,.29,5,1);
});
make('rainbell',['789caf','c4e9e8','4f788d','a0bad0','283d56','ecc391','f7f8e9','8cd8ce'],({root,b,group,box,eyes,fan})=>{
  b('raindrop',0,2.8,-.2,2.4,3.9,4.8,0);b('pale chin',0,1.72,2.27,2.02,1.94,2.03,1);b('crown',0,4.78,-.5,.36,1.27,1.47,2);eyes(1.22,3.24,1.5,.81);fan(-2.63,2.68,.82);
  for(const s of [-1,1]){const g=group(s<0?'bell_left':'bell_right',root,[s*.85,2.55,1.44]);box(g,'glass neck',s*1.59,2.22,2,.56,1.08,.75,1);box(g,'bell mantle',s*1.94,1.75,2.41,1.38,1.04,1.54,7);box(g,'scalloped rim',s*2.07,1.23,2.55,1.72,.33,1.86,1);box(g,'brass clapper',s*2,.88,2.54,.36,.72,.38,5);}
});
make('moonray',['394966','627587','29364c','495c79','202b40','a5c6cf','fff2c7'],({root,b,group,box,eyes})=>{
  b('night disc',0,1.66,0,4.5,1.46,6.1,0);b('round snout',0,1.51,3.19,2.9,1.03,1.53,1);for(const s of [-1,1]){const wing=group(s<0?'fin_left':'fin_right',root,[s*1.96,1.67,0]);for(let j=0;j<3;j++)box(wing,'wing fan',s*(2.6+j*.98),1.59,-j*.48,1.37,.57-j*.10,4.9-j*1.37,j===2?1:0,[0,s*15,0]);}
  for(const [x,z,w,d] of [[-1.36,-.88,.57,.77],[-1.21,-.17,.68,.95],[-.74,.53,.78,.82],[-.02,.93,.88,.67],[.75,1,.81,.46],[1.4,.84,.55,.29]])b('ivory crescent',x,.89,z,w,.14,d,6);
  eyes(1.02,2.38,2.63,.66);const t=group('tail',root,[0,1.54,-2.97]);box(t,'slender whip',0,1.51,-5.39,.54,.53,5.18,2);box(t,'silver tip',0,1.48,-8.02,.34,.31,.83,5);
});
const isletPaint = {
  jade:'508773', seaLeaf:'70a58a', shadow:'365f5b', mint:'b4cc9b', cream:'dbe1af',
  kelp:'397565', fin:'65aa90', finRay:'a2d1a1', ink:'253d43', honey:'e9b675', glint:'fff9d9',
  basalt:'526170', shale:'74868b', strata:'94a0a1', moss:'76934f', sunMoss:'a8ba6f',
  clay:'b56557', apricot:'ee9373', peach:'ffc78c', plum:'785d86', lilac:'b48bc6', orchid:'dfb5df',
  wetSand:'c8ac89', sand:'fff0d0', inlet:'187e87', lagoon:'41c5bd', foam:'acede0', shell:'ecb6a7',
  wine:'994d65', rose:'d75d75', flame:'f7817b', nectar:'ffd080', ivory:'fff8dd', pollen:'edb058',
};
// Skin, mantle, shadow, belly, fin root, fin blade, ray: only living tissue changes pigment.
const isletCoats = [
  ['99d9b8','b6e6c9','547d74','d6e3b9','78ad99','a9d8b6','e6ebbb'],
  ['80cba7','9cdab5','47756d','ccdfad','619e8a','93d1ac','dce9ad'],
  ['69b999','87cda8','3c6c62','bfdaa5','528f80','7fc3a3','d6e5a4'],
  ['53a78e','71be9c','32645c','b0d39e','428774','6ab797','cde4a3'],
  ['389283','5caa93','285a59','a2c997','327b6e','5aa78f','c2dd9e'],
  ['236f70','428e81','244e50','96c39a','286d64','469b88','b3d897'],
];
const isletSwatches = [...new Set([...Object.values(isletPaint),...isletCoats.flat()])];
make('islet',isletSwatches,({root,group,box})=>{
  const p = Object.fromEntries(Object.entries(isletPaint).map(([name,color])=>[name,isletSwatches.indexOf(color)]));
  const glaze = (side,up,down=side) => ({side:p[side],up:p[up],down:p[down]});
  const body=group('islet_body',root), saddle=[-.32,3.46,-1.15];
  group('deck_socket',body,saddle);
  const deck=group('islet_deck',root,saddle);
  const bed = (name,origin) => box.bind(null,group(name,deck,origin));
  const wrist=[0,2.02,-3.30], tailJoint=group('tail',body,wrist);
  // A square-section twig cut between two knots. The renderer applies X then Z rotation.
  function twig(put,name,a,end,width,depth,paint) {
    const [dx,dy,dz]=end.map((v,i)=>v-a[i]), length=Math.hypot(dx,dy,dz), deg=180/Math.PI;
    put(name,...a.map((v,i)=>(v+end[i])/2),width,length+.045,depth,paint,
      [Math.asin(dz/length)*deg,0,Math.atan2(-dx,dy)*deg].map(v=>Math.round(v*100)/100));
  }

  // Permanent facial landmarks are a single mesh shared by every coat.
  const face=box.bind(null,body);
  face('smile crease',0,1.58,5.12,2.21,.20,.57,p.shadow);
  for (const s of [-1,1]) {
    face('iris',s*2.21,2.69,4.19,.18,1.03,.96,glaze('honey','cream'));
    face('pupil',s*2.32,2.70,4.27,.12,.72,.68,p.ink);
    face('glint',s*2.40,2.88,4.44,.06,.23,.21,p.glint);
    face('smile corner',s*1.39,1.67,5.14,.68,.18,.51,p.shadow,[0,0,s*16]);
    face('smile dimple',s*2.19,1.79,4.56,.08,.19,.67,p.shadow,[23,0,0]);
    face('cheek freckle',s*2.20,2.08,3.69,.09,.20,.33,p.honey,[-15,0,0]);
  }
  // One spot becomes a broken, branching tide line. Accents are real relief on both flanks.
  const markings=[[-1.80,2.70,.31,.37,-29],[-1.17,2.84,.23,.51,9],[-.58,2.67,.24,.53,27],
    [-.10,2.91,.21,.56,-32],[.43,3.02,.21,.41,11],[-.43,2.40,.18,.32,32]];
  for (const [stage,colors] of isletCoats.entries()) {
    const [skin,mantle,shade,belly,rootFin,blade,ray]=colors.map(c=>isletSwatches.indexOf(c));
    const age=stage/5, young=1-age, sides=(side,up,down=side)=>({side,up,down});
    const b=box.bind(null,group('coat_'+stage,body,[0,0,0],stage===5));
    b('broad back',0,2.10,.15,4.72,2.75,5.63,sides(skin,mantle,shade));
    b('tapered rump',0,2.06,-2.66,3.79-.49*young,2.17-.24*young,1.91,sides(skin,mantle,shade));
    b('shoulder mantle',0,3.29,.81,4.24-.22*young,.73,4.49,sides(mantle,mantle));
    b('soft belly',0,.83,.88,4.31,1.22,5.71-.39*young,sides(belly,mantle,p.cream));
    b('big cheek',0,2.09,3.49,4.36,2.54,2.72,sides(mantle,mantle,belly));
    b('rounded brow',0,3.24,3.41,3.64,.47+.15*young,2.35,mantle,[6,0,0]);
    b('button muzzle',0,2.13,4.83,3.68,.98,1.03,mantle,[6,0,0]);
    b('smiling lip',0,1.35,5.05,3.61,.35,1.02,sides(belly,p.cream),[4,0,0]);
    b('chin',0,1.08,3.73,3.81,.64,1.97,belly);
    for (const s of [-1,1]) {
      b('gill crescent',s*2.20,2.03,3.10,.1,.69,.22,skin,[-20,0,0]);
      for (const [z,y,h,d,angle] of markings.slice(0,stage+1))
        b('flank embroidery',s*2.37,y,z,.08,h,d*(.70+.30*age),ray,[angle,0,0]);
      b('pectoral shoulder',s*2.43,1.72,1.75,.79,.66,1.04,rootFin,[0,s*23,0]);
      b('leaf paddle',s*(2.96-.15*young),1.39,1.19,1.42-.32*young,.48,1.99-.25*young,sides(rootFin,blade),[-13,-s*32,-s*13]);
      b('blade tip',s*(3.51-.35*young),1.10+.12*young,.40+.28*young,.84-.14*young,.31,1.37-.40*young,sides(blade,ray),[-13,-s*32,-s*13]);
      b('pectoral ray',s*(3.00-.13*young),1.57,1.02,.18,.16,1.60-.37*young,ray,[-13,-s*32,-s*13]);
    }
    const tail=box.bind(null,group('fan_'+stage,tailJoint,wrist,stage===5));
    tail('tail wrist',0,2.02,-3.64,1.95-.34*young,1.53-.20*young,1.47,sides(skin,mantle));
    tail('tail hinge',0,2.02,-4.44,.94,1,1.04,rootFin);
    tail('tail web',0,2.05,-5.00,.57,1.16-.24*young,1.49,blade);
    for (const [s,length] of [[1,2.63],[-1,2.10]]) {
      const sweep=[s*(14+10*age),0,0];
      tail('split fan',0,2.02+s*(.35+.20*age),-5.56+.18*young,.49,1.03-.16*young,length-.38*young,sides(blade,ray,rootFin),sweep);
      tail('fan leading ray',0,2.02+s*(.66+.31*age),-5.59+.18*young,.54,.24,length+.09-.38*young,ray,sweep);
    }
  }

  const b=bed('moss_rock',saddle);
  b('slate skerry',-.42,3.56,-1.43,3.16,.89,3.15,glaze('basalt','shale'),[5,16,-4]);
  b('stratified outcrop',-.82,4.01,-1.91,2.38,.88,2.73,glaze('shale','strata'),[7,-14,8]);
  b('velvet moss',-.87,4.40,-1.95,2.28,.40,2.61,glaze('moss','sunMoss'),[7,-14,8]);
  b('moss toe',.25,3.74,.19,2.35,.49,2.20,glaze('shale','moss'),[-5,-19,0]);
  b('lichen pillow',.59,4.04,-1.33,1.50,.54,1.85,glaze('moss','sunMoss'),[-12,16,-9]);
  b('sunward chip',-1.69,3.92,-.57,1.08,.48,1.42,glaze('strata','moss'),[-9,27,3]);

  const apr=bed('coral_1',[-1.1,4.13,-2.07]);
  const stem=[-1.11,5.24,-2.12], node=[-1.23,6.06,-2.03];
  twig(apr,'apricot holdfast',[-1.05,4.18,-2.20],stem,.62,.54,p.clay);
  twig(apr,'warm trunk',stem,node,.48,.47,p.apricot);
  for (const [base,elbow,tip] of [
    [stem,[-1.48,5.54,-3.14],[-1.59,6.41,-3.40]],
    [node,[-1.20,6.75,-1.90],[-1.37,7.30,-2.13]],
    [node,[-.89,6.32,-1.12],[-.86,7.02,-.93]],
  ]) {
    twig(apr,'antler fork',base,elbow,.40,.43,p.apricot);
    twig(apr,'sunlit finger',elbow,tip,.34,.36,glaze('peach','cream'));
  }

  const lil=bed('coral_2',[1.08,3.39,1.82]);
  twig(lil,'violet holdfast',[1.07,3.40,1.89],[1.24,4.37,2.04],.53,.56,p.plum);
  // Frilled, overlapping shelf whorls: short and spreading, unlike the staghorn.
  for (const [x,y,z,w,d,tilt,yaw] of [
    [1.34,4.07,2.32,1.80,1.34,12,15], [1.77,4.40,1.84,1.48,1.13,24,-22],
    [.95,4.57,2.34,1.20,.99,-20,28], [1.31,4.89,2.10,.85,.72,9,-9],
  ]) {
    lil('ruffled plate',x,y,z,w,.34,d,glaze('lilac','orchid','plum'),[-9,yaw,tilt]);
    lil('velvet centre',x,y+.13,z-.03,w*.71,.19,d*.71,p.lilac,[-9,yaw,tilt]);
  }

  const pool=bed('tide_pool',[1.35,3.63,-.46]);
  // Contiguous slices of a crescent. One bank bows out over the flank; the
  // two horns turn back onto the moss. Sand is visible on both sides of the water.
  for (const [z,x,w,water] of [[-2.28,1.03,1.14,.43],[-1.60,1.69,1.64,.94],
    [-.92,2.02,1.88,1.38],[-.24,2.17,1.88,1.42],[.44,2.03,1.69,1.20],
    [1.12,1.70,1.36,.76],[1.80,1.32,1.00,.30]]) {
    pool('shell sand bank',x,3.89,z,w,.63,.68,glaze('wetSand','sand','shale'));
    pool('lagoon',x-.025,4.226,z,water,.042,.68,glaze('inlet','lagoon'));
  }
  pool('deep runnel',2.04,4.253,-.60,.63,.035,1.30,p.inlet);
  pool('surface glimmer',2.41,4.26,-.36,.13,.034,.71,p.foam);
  pool('overflow lip',2.94,4.21,-.21,.36,.08,.41,p.lagoon);
  pool('little cascade',3.09,3.91,-.21,.08,.61,.38,glaze('lagoon','foam'));
  for (const [offset,h,lean] of [[-.23,.48,29],[0,.63,4],[.23,.49,-24]])
    pool('cockleshell rib',2.48+offset,4.39,.89,.24,h,.25,glaze(offset?'shell':'sand','ivory'),[-21,0,lean]);

  const arch=bed('tide_arch',[-.55,3.67,.70]);
  // Piers go fore and aft (Z), not across the fish (X). No slab behind the span.
  arch('seaward foot',-.47,4.13,-.97,1.17,.99,1.04,glaze('basalt','strata'),[0,6,0]);
  arch('shoreward foot',-.58,3.86,2.32,1.13,.82,1.16,glaze('shale','strata'),[0,-8,0]);
  arch('seaward pier',-.48,5.34,-.96,.84,2.05,.80,glaze('shale','strata'),[7,0,-4]);
  arch('shoreward pier',-.59,5.18,2.27,.94,2.13,.84,glaze('basalt','shale'),[-8,0,3]);
  arch('left springer',-.52,6.57,-.56,.91,1.32,.83,glaze('strata','strata'),[34,0,0]);
  arch('right springer',-.59,6.42,1.84,.98,1.34,.91,glaze('shale','strata'),[-35,0,0]);
  arch('weathered span',-.54,7.01,.66,.87,.66,2.48,glaze('strata','sunMoss','shale'),[4,0,0]);
  arch('canted keystone',-.54,7.12,.57,.99,.86,.68,glaze('shale','moss'),[-6,0,0]);
  arch('tide line',-.57,4.69,2.27,1.04,.26,.90,glaze('strata','moss'),[-8,0,3]);

  const garden=bed('flower_crown',[.21,4.09,-2.58]);
  // A sea fan drawn as a crooked lattice. Shared forks and two cross-veins
  // leave actual water between the ribs; the outermost bough leans over the tail.
  const foot=[.29,4.09,-2.59], fork=[.50,5.71,-2.80];
  const a=[.82,6.67,-4.12], bough=[.59,7.08,-2.94], c=[.34,6.72,-1.92];
  const d=[1.03,7.75,-5.32], e=[.92,8.16,-4.16], f=[.57,8.40,-2.80], g=[.20,7.95,-1.54];
  const branch=(u,v,w,col)=>twig(garden,'sea fan vein',u,v,w,w*.92,p[col]);
  branch(foot,fork,.53,'wine');
  for (const tip of [a,bough,c]) branch(fork,tip,.37,'rose');
  for (const [u,v] of [[a,d],[a,e],[bough,e],[bough,f],[c,f],[c,g]]) branch(u,v,.29,'rose');
  for (const [base,y,z] of [[d,8.14,-6.07],[d,8.69,-5.46],[e,9.26,-4.84],
    [e,9.46,-3.90],[f,9.48,-3.44],[f,9.10,-2.32],[g,8.79,-1.82],[g,8.23,-.89]]) {
    const tip=[base[0]+.14,y,z];
    branch(base,tip,.235,'flame');
    garden('gilded polyp',...tip,.29,.28,.29,glaze('peach','nectar'),[0,10,12]);
  }
  // Cupped four-petal anemones face obliquely out/up, so ivory reads in profile too.
  function flower(x,y,z,k,s) {
    const normal=[s*.6,.8,0], across=[.8,-s*.6,0];
    for(const [u,v] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      garden('ivory anemone petal',x+k*.30*across[0]*u,y+k*.30*across[1]*u,z+k*.30*v,
        k*(u?.53:.43),k*.24,k*(v?.56:.43),glaze('sand','ivory'),[v*20,0,-s*36-u*20]);
    }
    garden('saffron centre',x+k*.15*normal[0],y+k*.15*normal[1],z,k*.31,k*.26,k*.31,p.pollen,[0,0,-s*36]);
  }
  flower(1.15,8.24,-4.16,1.46,1);
  flower(-.13,7.30,.43,1.24,1);
  flower(-.66,7.49,-.09,.93,-1);
  flower(1.21,4.44,-1.40,.85,1);
});

make('frogfish',['a64e3b','d88456','7e403b','b85c44','352d36','edbc74','fff3c9'],({root,b,group,box,eyes,fan})=>{
  b('leaf body',0,2.6,0,3.6,4.5,5.7,0);b('forehead',0,3,2.5,3.4,4.1,2.4,1);b('upturned jaw',0,1.25,3.8,3.6,1.35,2.1,0,[-12,0,0]);
  for(let i=0;i<5;i++)b('dorsal leaf',0,4.45+i*.13,-2.65+i*1.08,.47,1.6,.8,i%2?0:3,[-26,0,0]);
  for(const s of [-1,1]){const f=group(s<0?'fin_left':'fin_right',root,[s*1.6,1.5,1.3]);box(f,'elbow',s*2,.89,1.3,.8,1.8,.93,2,[0,0,s*26]);box(f,'toes',s*2.4,.16,1.63,.95,.38,1.9,1);b('side ripple',s*1.83,3,-.45,.11,.6,2.4,1,[-19,0,0]);}
  b('lure stalk',0,5.9,3,.27,2.4,.29,2,[-17,0,0]);b('maple lure',0,7.07,3.8,.53,.82,1.42,3,[-22,0,0]);eyes(1.73,3.83,3.2,1.05);fan(-2.9,2.3,.85);
});
make('pinecone',['9a6a34','d9a044','eac269','997444','293741','f6d287','d1ffed','63decc'],({root,b,group,box,eyes,fan})=>{
  b('armour',0,3,0,3.5,4.35,6,0);b('face',0,2.75,3.03,2.95,3.35,2,1);
  for(const s of [-1,1])for(let row=0;row<2;row++)for(let j=0;j<3;j++)b('gilt scute',s*1.77,1.86+row*1.83,-1.99+j*1.76+row*.12,.20,1.27,1.27,2,[45,0,0]);
  for(let i=0;i<3;i++)b('dorsal spike',0,5.5,-1.8+i*1.55,.47,1.5,.51,0,[-20,0,0]);
  const lamps=group('lanterns',root,[0,1.38,3.62]);for(const s of [-1,1])box(lamps,'chin light',s*1.34,1.30,3.58,.61,.61,.78,7);eyes(1.51,3.6,3.28,1.13);fan(-3,2.7,.9);
});
make('archer',['8caba8','dddcc6','344b51','748d8c','253642','d6bc79','f5f6d7'],({b,eyes,fan})=>{
  b('silver back',0,2.8,-.2,2.5,3.05,7.1,0);b('flashing belly',0,1.67,-.1,2.4,1.12,6.4,1);b('tilted face',0,2.95,3.6,2.25,2.15,2.45,0,[-12,0,0]);b('upturned lip',0,3.35,5.04,1.6,.7,1.16,1,[-21,0,0]);
  for(let i=0;i<4;i++)b('ink saddle',0,3.5,-2.9+i*1.65,2.55,1.72,.58,2,[-17,0,0]);b('folded dorsal',0,4.65,-1.8,.32,1.05,2.5,3);eyes(1.16,3.63,4.06,.8);fan(-3.75,2.55,1.12);
});
make('bamboo',['a98e69','e3d2ad','695749','a68b6b','352f34','c2a279','fff0c7'],({root,b,group,box,eyes})=>{
  b('long back',0,2.25,-.4,3.15,2.7,8.5,0);b('rounded head',0,2.09,4.23,3.49,2.24,2.6,0);b('snout',0,1.93,5.81,2.94,1.72,1.57,0);b('belly',0,1.14,.8,2.88,.79,8.2,1);
  for(let i=0;i<4;i++)b('bamboo band',0,2.33,-3.85+i*2.32,3.22,2.64,.76,2);b('first dorsal',0,3.92,-.4,.55,1.74,1.18,2,[-22,0,0]);
  const stars=group('adult_stars',root);for(const s of [-1,1]){b('pectoral',s*2.12,1.37,2.05,1.55,.5,2.6,3,[0,s*26,0]);b('barbel',s*.96,1.03,6,.22,.89,.25,2);for(let j=0;j<4;j++)box(stars,'star',s*1.6,2.48+j%2*.43,-3.02+j*2.27,.14,.31,.36,6);}
  eyes(1.79,2.64,4.72,.69);const t=group('tail',root,[0,2,-4.52]);box(t,'long tail',0,1.97,-6.37,1.6,1.75,4.4,3);box(t,'tail band',0,1.97,-7.15,1.63,1.8,.68,2);box(t,'upper lobe',0,2.52,-9.2,.56,1.04,3.48,0,[20,0,0]);
});
make('dory',['b19659','cfb473','8c784f','ad9462','493e33','e7c989','fff3c8'],({root,b,group,box,eyes,fan})=>{
  b('mirror flank',0,3.4,0,1.72,5.7,5.8,0);b('upper arc',0,6.34,0,1.4,1.03,3.8,1);b('lower arc',0,.59,-.18,1.53,.93,3.76,1);b('cheek',0,3.58,3,1.52,3.6,2.14,1);
  for(const s of [-1,1]){b('ocellus rim',s*.91,3.5,-.66,.14,1.88,1.88,5,[45,0,0]);b('ocellus',s*1.02,3.5,-.66,.10,1.35,1.35,4,[45,0,0]);}
  for(let j=0;j<4;j++)b('crest ribbon',0,7.12-.16*j,1.2-j*.95,.24,2.68-j*.25,.29,2,[-10-j*6,0,0]);const mouth=group('tube_mouth',root,[0,3.4,3.68]);box(mouth,'mouth tip',0,3.34,4.32,1.18,.91,1.7,2);eyes(.81,4.6,3.45,.86);fan(-3,3.15,1.05);
});
make('moray',['766357','d2c5a4','8b7866','66554d','382f33','c8b080','fff1d6'],({root,b,group,box,eyes})=>{
  b('arched neck',0,2.19,.07,2.18,2.32,4.9,0,[-13,0,0]);b('cheek',0,2.93,2.83,2.43,2.36,2.73,0);b('long jaw',0,2.63,4.48,2.06,1.32,1.84,3);b('snout',0,3.25,4.39,2.11,1.01,1.91,0);b('low crest',0,3.17,-.9,.48,.97,2.9,2,[-12,0,0]);
  const t=group('tail',root,[0,1.8,-2.24]);box(t,'curved trunk',.34,1.63,-3.93,1.94,1.82,3.9,0,[0,-10,0]);box(t,'tapered end',.67,1.57,-6.85,1.14,1.17,3.1,3,[0,8,0]);
  for(const s of [-1,1]){for(let j=0;j<7;j++){let z=-1.7+j*.96; b('snow fleck',s*(z>1.4?1.23:1.1),2.24+.21*z+.3*(j%2),z,.16,.52,.45,1,[33,0,0]);}for(let j=0;j<4;j++)box(t,'tail rosette',.4+s*.88,1.76,-2.8-j*.86,.19,.42,.61,1);}
  eyes(1.25,3.59,3.54,.75);
});
make('dolphin',['719ba7','d7e5de','547b8a','85a8b2','243d49','cadae0','ffffff'],({root,b,group,box,eyes})=>{
  b('streamlined back',0,2.95,0,4.24,3.35,8.5,0);b('pale belly',0,1.69,.24,3.74,1.38,7.86,1);b('melon',0,3.09,4.27,3.78,3.08,3.16,3);b('rounded brow',0,3.27,5.67,3.13,2.11,1.5,3);b('short beak',0,2.66,7,1.92,1.16,2.32,0);b('smile',0,2.23,7.06,1.76,.44,2.3,1);b('blowhole',0,4.71,3.55,.51,.08,.65,2);
  b('swept dorsal',0,5.22,-.91,.68,2.24,1.78,2,[-27,0,0]);b('dorsal tip',0,6.34,-1.62,.42,.92,.88,2,[-25,0,0]);
  for(const s of [-1,1]){const f=group(s<0?'fin_left':'fin_right',root,[s*1.85,2.1,2.4]);box(f,'flipper',s*2.73,1.83,1.8,2.42,.72,2.44,2,[0,s*31,-s*15]);}
  eyes(1.94,3.35,4.58,.93);const t=group('tail',root,[0,2.88,-3.79]);box(t,'peduncle',0,2.66,-5.54,2.22,2.22,3.96,0);box(t,'tail wrist',0,2.23,-7.65,1.25,1.31,2.37,3);for(const s of [-1,1])box(t,'horizontal fluke',s*1.97,2.16,-8.56,4.1,.55,1.64,2,[0,s*22,0]);
});
