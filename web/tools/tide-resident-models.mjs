// Editable Blockbench sources for the tide-tank residents. +Z points towards the mouth.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodePNG } from './girl/glb.mjs';

const folder = new URL('../../models/shore/fish/', import.meta.url);
function make(id, colors, sculpt) {
  const source=JSON.parse(readFileSync(new URL('mullet.bbmodel',folder),'utf8'));
  let seq=0;
  const guid=()=>createHash('sha256').update(`${id}:${seq++}`).digest('hex').slice(0,32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
  source.name=source.model_identifier=id; source.elements=[]; source.outliner=[]; source.groups=[];
  const pixels=Buffer.alloc(16*16*4);
  for (let i=0;i<256;i++) {const color=Number.parseInt(colors[(i%16)%colors.length],16);pixels.set([color>>16,(color>>8)&255,color&255,255],i*4);}
  Object.assign(source.textures[0],{name:id+'_palette.png',uuid:guid(),source:'data:image/png;base64,'+encodePNG(16,16,pixels).toString('base64')});
  function group(name,parent,origin=[0,0,0]) {const uuid=guid(),node={uuid,children:[]};source.groups.push({uuid,name,origin,visibility:true});(parent?.children||source.outliner).push(node);return node;}
  function box(node,name,x,y,z,w,h,d,color,rotation) {
    const origin=[x,y,z],dim=[w,h,d],uuid=guid(),round=n=>Math.round(n*1000)/1000;
    source.elements.push({type:'cube',name,uuid,origin,from:origin.map((n,i)=>round(n-dim[i]/2)),to:origin.map((n,i)=>round(n+dim[i]/2)),
      ...(rotation?{rotation}:{}),box_uv:false,faces:Object.fromEntries(['up','down','north','south','east','west'].map(k=>[k,{texture:0,uv:[color,0,color+1,1]}]))});node.children.push(uuid);
  }
  const root=group('main'), b=(...args)=>box(root,...args);
  function eyes(x,y,z,size) {for(const s of [-1,1]) {b('iris',s*x,y,z,.18,size,size,5);b('pupil',s*(x+.1),y,z+.08,.09,size*.60,size*.60,4);b('glint',s*(x+.16),y+.15*size,z+.24*size,.06,size*.19,size*.18,6);}}
  function fan(z,y,size) {const fin=group('tail',root,[0,y,z]);box(fin,'stock',0,y,z-.48,.85,1.1,1.5,0);for(const s of [-1,1])box(fin,'fan lobe',0,y+s*.6*size,z-1.6*size,.42,.9*size,2.3*size,3,[s*22,0,0]);return fin;}
  sculpt({b,root,group,box,eyes,fan});writeFileSync(new URL(id+'.bbmodel',folder),JSON.stringify(source)+'\n');
}

make('foldsail',['558394','dfa95d','385a71','d58157','273847','eec37b','fff5d7','d1dbcf'],({root,b,group,box,eyes,fan})=>{
  b('hull',0,2.1,0,2.3,2.6,6.8,0);b('keel',0,.87,.1,1.7,.74,5.4,1);b('prow',0,2.1,3.9,1.86,1.51,2.05,0);eyes(1.16,2.67,2.65,.73);fan(-3.4,2.1,.9);
  const sail=group('folding_sail',root,[0,3.2,-2.7]);for(let j=0;j<6;j++){const h=1.1+j*.75;box(sail,'canvas pleat',0,3.24+h/2,-2.56+j*.72,.32,h,.78,j%2?6:7);}
  box(sail,'mast cap',0,8.04,1.03,.38,.34,.78,1);for(const s of [-1,1])b('gold sheer',s*1.17,2.02,0,.12,.29,5,1);
});
make('rainbell',['789caf','c4e9e8','4f788d','a0bad0','283d56','ecc391','f7f8e9','8cd8ce'],({root,b,group,box,eyes,fan})=>{
  b('raindrop',0,2.8,-.2,2.4,3.9,4.8,0);b('pale chin',0,1.72,2.27,2.02,1.94,2.03,1);b('crown',0,4.78,-.5,.36,1.27,1.47,2);eyes(1.22,3.24,1.5,.81);fan(-2.63,2.68,.82);
  for(const s of [-1,1]){const g=group(s<0?'bell_left':'bell_right',root,[s*.85,2.55,1.44]);box(g,'glass neck',s*1.59,2.22,2,.56,1.08,.75,1);box(g,'bell mantle',s*1.94,1.75,2.41,1.38,1.04,1.54,7);box(g,'scalloped rim',s*2.07,1.23,2.55,1.72,.33,1.86,1);box(g,'brass clapper',s*2,.88,2.54,.36,.72,.38,5);}
});
make('moonray',['394966','627587','29364c','495c79','202b40','a5c6cf','fff2c7'],({root,b,group,box,eyes})=>{
  b('night disc',0,1.66,0,4.5,1.46,6.1,0);b('round snout',0,1.51,3.19,2.9,1.03,1.53,1);for(const s of [-1,1]){const wing=group(s<0?'fin_left':'fin_right',root,[s*1.96,1.67,0]);for(let j=0;j<3;j++)box(wing,'wing fan',s*(2.6+j*.98),1.59,-j*.48,1.37,.57,4.9-j*1.37,j===2?1:0,[0,s*15,0]);}
  for(const [x,z,w,d] of [[-1.36,-.88,.57,.77],[-1.21,-.17,.68,.95],[-.74,.53,.78,.82],[-.02,.93,.88,.67],[.75,1,.81,.46],[1.4,.84,.55,.29]])b('ivory crescent',x,.89,z,w,.14,d,6);
  eyes(1.02,2.38,2.63,.66);const t=group('tail',root,[0,1.54,-2.97]);box(t,'slender whip',0,1.51,-5.39,.54,.53,5.18,2);box(t,'silver tip',0,1.48,-8.02,.34,.31,.83,5);
});
make('islet',['547f79','a8b89c','61747d','799994','2e454d','d6b581','e6eabf','e49378','b980ae'],({root,b,group,box,eyes,fan})=>{
  b('broad back',0,2.11,0,4.72,2.76,7.33,0);b('soft belly',0,1.02,.29,4.26,1.33,6.36,1);b('big cheek',0,2.08,3.83,4.36,2.39,2.2,3);b('smiling lip',0,1.44,5.06,3.43,.67,1.05,1);eyes(2.24,2.69,4.28,.9);fan(-3.63,2.04,1.21);
  b('reef pedestal',0,3.69,-.71,2.99,1.24,3.34,2);b('cap of moss',.16,4.24,-.71,2.45,.27,2.94,1);
  for(const [i,x,z,c] of [[1,-.73,-.17,7],[2,.69,-1.32,8]]) {const g=group('coral_'+i,root,[x,4.3,z]);box(g,'stem',x,5.26,z,.44,1.96,.44,c);box(g,'side arm',x+.4,5.48,z,.95,.37,.38,c);box(g,'branch tip',x+.77,5.87,z,.33,.94,.35,c);box(g,'fork',x-.27,6.16,z,.37,.97,.39,c,[0,0,22]);}
  for(const s of [-1,1])b('paddle',s*2.72,1.49,1.83,1.61,.59,2.4,3,[0,s*25,0]);
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
  const lamps=group('lanterns',root,[0,1.38,3.62]);for(const s of [-1,1])box(lamps,'chin light',s*1.34,1.38,3.58,.61,.61,.78,7);eyes(1.51,3.6,3.28,1.13);fan(-3,2.7,.9);
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
