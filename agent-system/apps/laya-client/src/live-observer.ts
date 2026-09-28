import type {World,SensoryOverlay} from '../../../packages/sim-core/src/domain.ts';
import type {CommitRecord} from '../../../packages/sim-core/src/cognition.ts';
import {getOverlay} from '../../../packages/sim-core/src/perception.ts';
import {ResidentJournal} from './journal.ts';

/** Live play has no frame archive. Only the latest selected sensory overlay is retained. */
export class LiveObserver {
  private collected='';private overlayKey='';private overlay:Record<string,SensoryOverlay>={};
  readonly journal:ResidentJournal;
  constructor(journal:ResidentJournal){this.journal=journal;}
  observe(world:World):void{
    const key=world.runId+':'+world.revision+':'+world.tick;
    if(key===this.collected)return;this.journal.collect(world);this.collected=key;
  }
  senses(world:World,id:string,enabled:boolean):Record<string,SensoryOverlay>{
    const key=enabled?[world.runId,world.revision,world.tick,id].join(':'):'off';
    if(key!==this.overlayKey){const resident=enabled?world.residents.find(r=>r.id===id):undefined;this.overlay=resident?{[id]:getOverlay(world,resident)}:{};this.overlayKey=key;}
    return this.overlay;
  }
}

/** One complete checkpoint stays atomic; do not serialize the same world twice or store all model inputs. */
export function liveCheckpoint(record:CommitRecord){
  return {schemaVersion:'1.0.0',world:record.nextWorld,commit:{
    schemaVersion:record.schemaVersion,runId:record.runId,barrierId:record.barrierId,tick:record.tick,
    beforeHash:record.beforeHash,afterHash:record.afterHash,
    decisions:record.accepted.map(a=>({agentId:a.request.metadata.agentId,requestId:a.request.metadata.requestId,source:a.response.source,model:a.response.model}))
  }};
}
