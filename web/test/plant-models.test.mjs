// Restored plant contracts after the user rejected the 2026-11-09 simplification.
// Tests use repository models only; temporary rollback backups are not required.
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
 flower_pot:{bounds:[[5,0,4.5],[11.5,10,11.5]],texture:[128,96],elements:28},
 potted_fern:{bounds:[[3.5,0,3.5],[12.5,9.5,14.5]],texture:[128,96]},
 floor_plant:{bounds:[[2,0,1],[10,15,9]],texture:[128,96]},
 succulents:{bounds:[[2,0,2.5],[14,5,13.5]],texture:[128,80]},
 flower_box_purple:{bounds:[[0,3,9],[32,15,16]],texture:[256,112],cells:2},
 flower_box_pink:{bounds:[[0,3,9],[32,15.5,16]],texture:[256,112],cells:2},
 hanging_basket:{bounds:[[4.5,0,-6.5],[12,15.5,9]],texture:[128,112]},
};
for(const [id,c] of Object.entries(configs))test(id+': restored geometry, texture UV and per-cell export',async()=>{
 const file=path.join(root,'models/furniture',id+'.bbmodel'),b=JSON.parse(fs.readFileSync(file));
 assert.equal(b.meta.model_format,'java_block');
 const cells=c.cells||1;
 assert.equal(b.elements.length,c.elements??32*cells,c.elements?'intentional stair flowerpot element count':'restored model element count');
 const ids=new Set(b.elements.map(e=>e.uuid));assert.equal(ids.size,b.elements.length,'unique UUIDs');
 const refs=[];const walk=n=>{if(typeof n==='string')refs.push(n);else for(const ch of n.children||[])walk(ch);};b.outliner.forEach(walk);
 assert.equal(refs.length,ids.size);assert.equal(new Set(refs).size,ids.size);for(const r of refs)assert(ids.has(r),'outliner resolves every element');
 assert.equal(b.outliner.length,cells,'placement groups preserved');
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const e of b.elements){
  assert.equal(e.type,'cube');
  for(let a=0;a<3;a++){
   assert(Number.isFinite(e.from[a])&&Number.isFinite(e.to[a]));assert(e.to[a]>e.from[a],'positive-volume cubes');
   lo[a]=Math.min(lo[a],e.from[a]);hi[a]=Math.max(hi[a],e.to[a]);
  }
  let faces=0;
  for(const face of Object.values(e.faces)){
   if(face.texture===null)continue;faces++;assert(b.textures[face.texture],'face references embedded texture');
   assert.equal(face.uv.length,4);assert(face.uv.every(Number.isFinite));
   assert(face.uv.every((v,i)=>v>=0&&v<=b.resolution[i%2?'height':'width']),'UV inside atlas');
  }
  assert(faces>0,'every cube has visible faces');
 }
 assert.deepEqual([lo,hi],c.bounds,'restored placement envelope including hanging overhang');
 assert.equal(b.textures.length,1,'restored original atlas');
 const tex=b.textures[0];assert(tex.source.startsWith('data:image/png;base64,'));
 const atlas=await decodePng(Buffer.from(tex.source.split(',')[1],'base64'));
 assert.deepEqual([atlas.width,atlas.height],c.texture);assert.deepEqual([b.resolution.width,b.resolution.height],c.texture);
 assert(atlas.data.some((v,i)=>i%4===3&&v>0),'texture contains visible pixels');
 const out=await exportOne(furnMc().byId(id),file);
 assert.deepEqual(out.notes,[],'in-memory conversion has no missing materials/groups');assert.equal(out.stats.cells.length,cells);
 assert.equal(out.stats.cells.reduce((n,c)=>n+c.elements,0),b.elements.length,'export retains every element');
 for(const cell of out.stats.cells)assert(cell.elements>0&&cell.elements<=32,'32 is the per-cell ceiling');
 for(const [name,bytes] of out.files)if(name.endsWith('.json')){const text=bytes.toString();assert(!text.includes('minecraft:block/'),'no Mojang block resource reference');JSON.parse(text);}
 console.log(`${id}: restored ${b.elements.length} cubes, cells ${out.stats.cells.map(s=>s.elements)}, valid atlas and clean in-memory export`);
});
