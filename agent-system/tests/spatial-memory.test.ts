import test from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../packages/sim-core/src/world.ts';import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {rememberFootstep,rememberMapCell,buildSpatialContext,MAP_CELL_LIMIT,MAP_TRAIL_LIMIT} from '../packages/sim-core/src/spatial-memory.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';import {validateCharacterContext} from '../packages/contracts/src/validation.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
function scene(){const w=createWorld();w.objects=[w.objects[0]];w.objects[0].position={x:4,y:0,z:0};w.residents[0].position={x:0,y:0,z:0};w.residents[0].heading=0;w.residents[1].position={x:-4,y:0,z:0};w.residents[1].heading=Math.PI;return w;}
test('Each resident has a private structured map; unknown terrain and hidden changes cannot leak',()=>{
 const w=scene();samplePerception(w);const[a,b]=w.residents,am=buildSpatialContext(a)!,bm=buildSpatialContext(b)!;
 assert.ok(am.landmarks.some(l=>l.kind==='tree'));assert.ok(!bm.landmarks.some(l=>l.kind==='tree'));assert.notDeepEqual(am.cells,bm.cells);
 assert.ok(!am.cells.some(c=>c.x===15&&c.z===15));const before=JSON.stringify(buildContext(w,b));w.objects[0].appearance='秘密改变';w.objects[0].position.x=90;w.objects[0].resources=0;w.tick=4;samplePerception(w);assert.equal(JSON.stringify(buildSpatialContext(b)),JSON.stringify(bm));
 assert.ok(!JSON.stringify(buildContext(w,b)).includes('秘密改变'));validateCharacterContext(buildContext(w,a));assert.ok(!JSON.stringify(am).includes('origin'));assert.ok(!JSON.stringify(am).includes(w.objects[0].id));assert.ok(before.length>0);
});
test('Route stores actually visited coarse cells, and small movement avoids duplicate text memories or cognition',()=>{
 const w=scene(),r=w.residents[0];samplePerception(w);const count=r.memories.length;
 r.plan=[{action:{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false}];
 r.position.x=.05;w.tick=4;assert.ok(!samplePerception(w).includes(r.id));assert.equal(r.spatialMemory!.trail.length,1);assert.equal(r.memories.length,count);
 r.position.x=2.1;rememberFootstep(r,5);assert.deepEqual(r.spatialMemory!.trail,[{x:0,z:0},{x:1,z:0}]);assert.ok(buildSpatialContext(r)!.cells.some(c=>c.x===1&&c.z===0&&c.state==='visited'));
});
test('Map retains previously seen resources while unseen resource changes stay unknown',()=>{
 const w=scene(),r=w.residents[0];samplePerception(w);const remembered=structuredClone(r.spatialMemory!.landmarks);r.heading=Math.PI;w.objects[0].resources=0;w.objects[0].position.x=80;w.tick=4;samplePerception(w);for(const [ref,landmark]of Object.entries(remembered))assert.deepEqual(r.spatialMemory!.landmarks[ref],landmark);
 const before=hashCanonical(w);const map=buildSpatialContext(r)!;map.cells[0].x=1000;assert.equal(hashCanonical(w),before);
});
test('Map and trail stay bounded; snapshot restoration retains structured and text memories independently',()=>{
 const w=scene(),r=w.residents[0];for(let i=0;i<400;i++){r.position.x=i*2;rememberFootstep(r,i);rememberMapCell(r,{x:i*2,y:0,z:4},i);}
 assert.ok(Object.keys(r.spatialMemory!.cells).length<=MAP_CELL_LIMIT);assert.equal(r.spatialMemory!.trail.length,MAP_TRAIL_LIMIT);const copy=JSON.parse(JSON.stringify(r));assert.deepEqual(buildSpatialContext(copy),buildSpatialContext(r));assert.ok(copy.memories.some((m:any)=>m.ref==='memory_background'));
});
test('Global cognition pause freezes map memory too, and observer map reads never change it',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const sim=new Simulation({async decide(req){await gate;return {metadata:req.metadata,source:'MOCK_TEST',model:'explicit-map-freeze-fixture',decision:{schemaVersion:'1.0.0',decisionKind:'replace',goal:'test',reasonBrief:'test',actions:[{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]}};}},{world:scene(),allowMock:true});
 const pending=sim.bootstrap(),before=hashCanonical(sim.world);for(let i=0;i<50;i++){sim.frame(i*1000);buildSpatialContext(sim.world.residents[0]);}assert.equal(hashCanonical(sim.world),before);release();await pending;sim.frame(60000);assert.equal(sim.world.tick,0);sim.stop();
});
