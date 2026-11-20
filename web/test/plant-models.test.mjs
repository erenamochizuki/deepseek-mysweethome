import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {furnMc} from '../tools/lib/furn-mc-vox.mjs';
import {exportOne} from '../tools/lib/furn-mc-export.mjs';
import {decodePng} from '../tools/mc-lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const configs={
 flower_pot:{bounds:[[5,0,4.75],[11.5,10,11.25]],texture:[64,64],elements:4,crosses:1},
 potted_fern:{bounds:[[3.4,0,3.4],[13.1,12.7,13.1]],texture:[128,128],elements:13,crosses:1},
 floor_plant:{bounds:[[2,0,1],[10,15,9]],texture:[128,96]},
 succulents:{bounds:[[2,0,2.5],[14,7.5,13.5]],texture:[128,112],elements:31,crosses:1,petals:12},
 flower_box_purple:{bounds:[[0,3,9],[32,15,16]],texture:[64,64],cells:2,elements:20,crosses:6},
 flower_box_pink:{bounds:[[0,3,9],[32,15.5,16]],texture:[64,64],cells:2,elements:20,crosses:6},
 hanging_basket:{bounds:[[4.85,0,-5.57868],[11.47,15.5,9]],texture:[64,64],elements:16,crosses:2,trails:1},
 dining_table:{bounds:[[0.5,0,0.5],[16,16,16]],texture:[128,128],elements:21,crosses:1},
};
for(const [id,c] of Object.entries(configs))test(id+': geometry, texture UV and per-cell export',async()=>{
 const file=path.join(root,'models/furniture',id+'.bbmodel'),b=JSON.parse(fs.readFileSync(file));
 assert.equal(b.meta.model_format,'java_block');
 if(id==='potted_fern'||id==='succulents')assert.equal(b.java_block_version,'1.21.11','Blockbench target includes MC 26.1.2');
 const cells=c.cells||1;
 assert.equal(b.elements.length,c.elements??32*cells,'authored element count');
 const ids=new Set(b.elements.map(e=>e.uuid));assert.equal(ids.size,b.elements.length,'unique UUIDs');
 const refs=[];const walk=n=>{if(typeof n==='string')refs.push(n);else for(const ch of n.children||[])walk(ch);};b.outliner.forEach(walk);
 assert.equal(refs.length,ids.size);assert.equal(new Set(refs).size,ids.size);for(const r of refs)assert(ids.has(r),'outliner resolves every element');
 assert.equal(b.outliner.length,cells,'placement groups preserved');
 const planes=[];
 for(const e of b.elements){
  assert.equal(e.type,'cube');
  for(let a=0;a<3;a++){
   assert(Number.isFinite(e.from[a])&&Number.isFinite(e.to[a]));assert(e.to[a]>=e.from[a]);
  }
  let faces=0;
  for(const face of Object.values(e.faces)){
   if(face.texture===null)continue;faces++;assert(b.textures[face.texture],'face references embedded texture');
   assert.equal(face.uv.length,4);assert(face.uv.every(Number.isFinite));
   assert(face.uv.every((v,i)=>v>=0&&v<=b.resolution[i%2?'height':'width']),'UV inside atlas');
  }
  assert(faces>0,'every cube has visible faces');
  if(e.from.some((value,axis)=>value===e.to[axis])){
   assert(c.crosses);assert.equal(e.shade,false);assert.equal(faces,2);
   const pair=e.from[1]===e.to[1]?['up','down']:e.from[0]===e.to[0]?['west','east']:['north','south'];
   assert(pair.every(side=>e.faces[side].texture===0));assert.deepEqual(e.faces[pair[0]].uv,e.faces[pair[1]].uv);
   planes.push({element:e,uv:e.faces[pair[0]].uv,axis:pair[0]});
  }
 }
 assert.equal(planes.filter(p=>p.axis==='up' && p.element.rotation[0]>0).length,c.petals||0);
 assert.equal(planes.length,(c.crosses||0)*2+(c.trails||0)+(c.petals||0));
 const clusters=new Map();for(const {element,axis} of planes.filter(p=>p.element.rescale)){
  assert.deepEqual(element.rotation,[0,45,0]);const key=JSON.stringify(element.origin);
  if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(axis);
 }
 assert.equal(clusters.size,c.crosses||0);for(const axes of clusters.values())assert.deepEqual(axes.sort(),['north','west']);
 assert.equal(b.textures.length,1,'one embedded atlas');
 const tex=b.textures[0];assert(tex.source.startsWith('data:image/png;base64,'));
 const atlas=await decodePng(Buffer.from(tex.source.split(',')[1],'base64'));
 assert.deepEqual([atlas.width,atlas.height],c.texture);assert.deepEqual([b.resolution.width,b.resolution.height],c.texture);
 assert(atlas.data.some((v,i)=>i%4===3&&v>0),'texture contains visible pixels');
 for(const {uv:[left,top,right,bottom]} of planes){
  const alpha=new Set();for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)alpha.add(atlas.data[(y*atlas.width+x)*4+3]);
  assert.deepEqual([...alpha].sort(),[0,255],'each foliage sprite has both cutout and opaque pixels');
 }
 const out=await exportOne(furnMc().byId(id),file);
 if(c.crosses)assert.deepEqual(JSON.parse([...out.files].find(([key])=>key.endsWith('.png.mcmeta'))[1]),{texture:{mipmap_strategy:'strict_cutout'}});
 const boxes=out.stats.cells.map((cell,index)=>cell.box.map((value,axis)=>value+(axis%3===0?index*16:0)));
 assert.deepEqual([0,1].map(upper=>[0,1,2].map(axis=>Math[upper?'max':'min'](...boxes.map(box=>box[axis+upper*3])))),c.bounds,'baked placement envelope');
 assert.deepEqual(out.notes,[],'in-memory conversion has no missing materials/groups');assert.equal(out.stats.cells.length,cells);
 assert.equal(out.stats.cells.reduce((n,c)=>n+c.elements,0),b.elements.length,'export retains every element');
 for(const cell of out.stats.cells)assert(cell.elements>0&&cell.elements<=32,'32 is the per-cell ceiling');
 for(const [name,bytes] of out.files)if(name.endsWith('.json')){const text=bytes.toString();assert(!text.includes('minecraft:block/'),'no Mojang block resource reference');JSON.parse(text);}
});
