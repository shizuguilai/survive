import {test} from 'node:test';import assert from 'node:assert/strict';
import {ReplayRecorder,ReplayPlayer} from '../packages/sim-core/src/replay.ts';
import {createWorld} from '../packages/sim-core/src/world.ts';
import type {BrainRequest,BrainResponse} from '../packages/contracts/src/types.ts';

function fixture(){
 const r=new ReplayRecorder(),w=createWorld({runId:'test-replay'});r.capture(w,{});
 r.commit({tick:0,accepted:[{request:{} as BrainRequest,response:{source:'MOCK_TEST'} as BrainResponse}]});
 for(let i=1;i<=30;i++){w.tick=i;w.residents[0].position.x=i/10;r.capture(w,{});}
 return r;
}
test('R01/R03 replay snapshots seek without provider and retain true action duration',()=>{
 const p=new ReplayPlayer(fixture().export(true));assert.equal(p.manifest.decisionMode,'mock');assert.equal(p.manifest.endTick,30);
 assert.equal(p.seek(12).world.residents[0].position.x,1.2);assert.equal(p.seek(2).world.residents[0].position.x,.2);
 const s=p.current();s.world.residents[0].position.x=999;assert.equal(p.current().world.residents[0].position.x,.2);
 p.setSpeed(2);p.play();p.frame(1000);p.frame(1050);assert.equal(p.tick,4);
});
test('R02 playback wall pause discards waiting and freezes at incomplete buffer edge',()=>{
 const p=new ReplayPlayer(fixture().export(false));p.play();p.frame(0);p.frame(50);assert.equal(p.tick,1);
 p.pause();p.frame(30000);p.play();p.frame(40000);assert.equal(p.tick,1);p.frame(40050);assert.equal(p.tick,2);
 p.seek(29);p.play();p.frame(0);p.frame(500);assert.equal(p.tick,30);assert.ok(p.buffering);assert.equal(p.playing,false);
});
test('S03 replay detects incompatible configuration and altered snapshots',()=>{
 const config=fixture().export(true);config.manifest.configHash='0'.repeat(64);assert.throws(()=>new ReplayPlayer(config),/不兼容/);
 const bad=fixture().export(true);bad.frames[4].world.tick=7;assert.throws(()=>new ReplayPlayer(bad),/校验/);
 const mode=fixture().export(true);mode.manifest.decisionCounts.real=1;assert.throws(()=>new ReplayPlayer(mode),/来源/);
});
test('R04 empty static world cannot masquerade as accepted autonomous run',()=>{
 const r=new ReplayRecorder();r.capture(createWorld(),{});assert.throws(()=>r.export(),/尚无/);
});
