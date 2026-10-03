import {CONTEXT_LIMITS} from '../../contracts/src/context-limits.ts';
import type {Memory,Observation} from '../../contracts/src/types.ts';
import type {KnowledgeEntry,Resident} from './domain.ts';

/** Select a bounded view of private knowledge, never delete the resident's history.
 * Evidence packages are accepted together with all their retained source chains;
 * an old summary that exceeds this request's budget stays in long-term memory.
 */
export function selectContextKnowledge(resident:Resident,equipmentRefs:string[]):{
  refs:Set<string>;observations:Observation[];memories:Memory[];
}{
  const entries=Object.values(resident.known).filter(k=>!k.entityId.startsWith('supply-')||['wood','stone','food'].some(kind=>k.entityId===`supply-${kind}-${resident.id}`));
  const available=new Set([...entries.map(k=>k.ref),...equipmentRefs]);
  const refs=new Set<string>();
  const addRef=(ref:unknown)=>{if(typeof ref==='string'&&available.has(ref)&&refs.size<CONTEXT_LIMITS.knownTargets)refs.add(ref);};
  const actionRefs=(plan:Resident['plan'])=>{
    for(const p of plan)if(!p.done)for(const [key,value]of Object.entries(p.action.params))if(key.endsWith('Ref'))addRef(value);
  };
  actionRefs(resident.plan);
  actionRefs(resident.suspendedPlan);
  for(const watch of resident.lastDecision?.watch??[])addRef(watch.knownRef);
  // Keep the resident's own tools and learned camp facilities usable even after
  // a large farm creates hundreds of personally observed crop references.
  for(const ref of equipmentRefs)addRef(ref);
  const essentials=entries.filter(k=>k.entityId===resident.homeId||['camp-board','camp-workbench','camp-pond'].includes(k.entityId)||k.entityId.startsWith('supply-')||k.entityId.startsWith('recipe:'));
  for(const entry of essentials)addRef(entry.ref);

  const observations:Observation[]=[],memories:Memory[]=[];
  const observationRefs=new Set<string>(),memoryRefs=new Set<string>();
  const observationByRef=new Map(resident.observations.map(o=>[o.obsRef,o]));
  const memoryByRef=new Map(resident.memories.map(m=>[m.ref,m]));
  const offer=(sourceRefs:string[]):void=>{
    const pending=[...sourceRefs],newObservations:Observation[]=[],newMemories:Memory[]=[];
    const seen=new Set<string>(),needed=new Set<string>();
    for(let i=0;i<pending.length;i++){
      const ref=pending[i];if(seen.has(ref))continue;seen.add(ref);
      const observation=observationByRef.get(ref);
      if(observation&&!observationRefs.has(ref)){
        newObservations.push(observation);
        for(const key of ['knownRef','speakerKnownRef']){
          const target=observation.detail[key];
          if(typeof target==='string'){
            // No capability may be invented to repair a malformed source.
            if(!available.has(target))return;
            if(!refs.has(target))needed.add(target);
          }
        }
      }
      const memory=memoryByRef.get(ref);
      if(memory&&!memoryRefs.has(ref)){newMemories.push(memory);pending.push(...memory.evidenceRefs);}
      if(!observation&&!memory)return;
      if(refs.size+needed.size>CONTEXT_LIMITS.knownTargets||observations.length+newObservations.length>CONTEXT_LIMITS.observations||memories.length+newMemories.length>CONTEXT_LIMITS.memories)return;
    }
    for(const ref of needed)refs.add(ref);
    for(const observation of newObservations){observations.push(observation);observationRefs.add(observation.obsRef);}
    for(const memory of newMemories){memories.push(memory);memoryRefs.add(memory.ref);}
  };
  for(const observation of resident.observations.slice(-24))offer([observation.obsRef]);
  for(const progress of [...resident.plan,...resident.suspendedPlan])if(!progress.done&&Array.isArray(progress.action.params.evidenceRefs))offer(progress.action.params.evidenceRefs);
  const recentActions=resident.memories.filter(m=>m.ref.startsWith('memory_spoken_')||m.ref.startsWith('memory_action_')||m.ref.startsWith('memory_task_')).slice(-10);
  for(const memory of [...resident.memories.slice(-24),...recentActions])offer([memory.ref]);

  const distance=(k:KnowledgeEntry)=>Math.hypot(k.lastPosition.x-resident.position.x,k.lastPosition.z-resident.position.z);
  const priority=(k:KnowledgeEntry)=>k.entityId.startsWith('task-')&&!k.description.includes('已完成')||k.entityId.startsWith('field-')?0:k.visible?1:resident.spatialMemory?.landmarks[k.ref]?2:3;
  const ranked=[...entries].sort((a,b)=>priority(a)-priority(b)||distance(a)-distance(b)||b.lastSeenTick-a.lastSeenTick||a.ref.localeCompare(b.ref));
  for(const entry of ranked)addRef(entry.ref);
  return {refs,observations,memories};
}
