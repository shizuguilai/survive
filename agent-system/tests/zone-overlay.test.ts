import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zoneOverlayGeometry} from '../apps/laya-client/src/zone-overlay.ts';

test('overlapping residential fills cover the exact union once and omit internal borders',()=>{
 const result=zoneOverlayGeometry([{minX:0,maxX:8,minZ:0,maxZ:8},{minX:4,maxX:12,minZ:4,maxZ:12}]);
 assert.equal(result.fills.reduce((n,b)=>n+(b.maxX-b.minX)*(b.maxZ-b.minZ),0),112);
 const coverage=(x:number,z:number)=>result.fills.filter(b=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ).length;
 assert.equal(coverage(6,6),1);assert.equal(coverage(2,10),0);assert.equal(coverage(10,2),0);
 for(const [a,b]of result.edges){const x=(a.x+b.x)/2,z=(a.z+b.z)/2;assert.ok(!(x>4&&x<8&&z>4&&z<8));}
 const perimeter=result.edges.reduce((n,[a,b])=>n+Math.hypot(a.x-b.x,a.z-b.z),0);assert.equal(perimeter,48);
});
test('repeated selections and shared edges do not create seams or change coverage',()=>{
 const box={minX:0,maxX:8,minZ:0,maxZ:8};
 assert.deepEqual(zoneOverlayGeometry([box,box]),zoneOverlayGeometry([box]));
 const touching=zoneOverlayGeometry([box,{minX:8,maxX:16,minZ:0,maxZ:8}]);
 assert.equal(touching.fills.reduce((n,b)=>n+(b.maxX-b.minX)*(b.maxZ-b.minZ),0),128);
 assert.ok(!touching.edges.some(([a,b])=>a.x===8&&b.x===8));
 assert.deepEqual(zoneOverlayGeometry([]),{fills:[],edges:[]});
});
