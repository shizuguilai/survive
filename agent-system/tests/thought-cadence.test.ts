import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThoughtCadence} from '../apps/laya-client/src/thought-cadence.ts';

test('Thoughts last four seconds and identical wishes across residents recur only after ninety seconds',()=>{
 const cadence=new ThoughtCadence(),people=[{id:'a',text:'我好想有个家。'},{id:'b',text:'我好想有个家。'}],starts=new Map<number,string>();
 for(let now=0;now<=120000;now+=100){const bubble=cadence.update('run',now,people);if(bubble){starts.set(bubble.started,bubble.id);assert.ok(now-bubble.started<4000);}}
 assert.deepEqual([...starts],[[8000,'a'],[98000,'b']]);
});

test('Changed wishes and camera visibility cannot bypass the quiet interval; speech takes priority',()=>{
 const cadence=new ThoughtCadence(),a={id:'a',text:'想有个家。'},b={id:'b',text:'想做一张床。'};
 assert.equal(cadence.update('run',0,[a,b]),null);
 assert.equal(cadence.update('run',8000,[a,b])?.id,'a');
 assert.equal(cadence.update('run',8250,[a,b])?.alpha,1);
 assert.equal(cadence.update('run',9000,[]),null);
 assert.equal(cadence.update('run',10000,[a,b]),null);
 assert.equal(cadence.update('run',37000,[a,b],true),null);
 assert.equal(cadence.update('run',38000,[a,b])?.id,'b');
 assert.equal(cadence.update('run',39000,[a,{...b,text:'想装盏灯。'}]),null);
 assert.equal(cadence.update('run',40000,[a,b]),null);
});

test('An unchanged world still lets observer bubbles fade and expire; a new run resets the delay',()=>{
 const cadence=new ThoughtCadence(),people=[{id:'a',text:'想有个家。'}],before=JSON.stringify(people);
 cadence.update('old',0,people);cadence.update('old',8000,people);
 assert.ok(cadence.update('old',11900,people)!.alpha<.3);
 assert.equal(cadence.update('old',12000,people),null);
 assert.equal(JSON.stringify(people),before);
 assert.equal(cadence.update('new',12000,people),null);
 assert.equal(cadence.update('new',19900,people),null);
 assert.equal(cadence.update('new',20000,people)?.id,'a');
});
