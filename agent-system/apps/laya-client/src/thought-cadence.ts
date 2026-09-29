export type ThoughtCandidate={id:string;text:string};
type ActiveThought=ThoughtCandidate&{started:number};
/** Observer time only: a reminder can fade during a model wait without advancing the world. */
export class ThoughtCadence{
 private run:string|null=null;private nextAt=0;private active:ActiveThought|null=null;
 private lastText=new Map<string,number>();private lastResident=new Map<string,number>();
 update(run:string,now:number,candidates:ThoughtCandidate[],speaking=false):(ActiveThought&{alpha:number})|null{
  if(this.run!==run){this.run=run;this.active=null;this.nextAt=now+8000;this.lastText.clear();this.lastResident.clear();}
  if(this.active&&(speaking||now-this.active.started>=4000||!candidates.some(c=>c.id===this.active!.id&&c.text===this.active!.text)))this.active=null;
  if(!this.active&&!speaking&&now>=this.nextAt){
   const ready=candidates.filter(c=>c.text&&now-(this.lastText.get(c.text)??-Infinity)>=90000&&now-(this.lastResident.get(c.id)??-Infinity)>=45000)
    .sort((a,b)=>(this.lastResident.get(a.id)??-Infinity)-(this.lastResident.get(b.id)??-Infinity));
   const c=ready[0];if(c){this.active={...c,started:now};this.lastText.set(c.text,now);this.lastResident.set(c.id,now);this.nextAt=now+29000;}
  }
  if(!this.active)return null;
  const age=now-this.active.started;return {...this.active,alpha:Math.max(0,Math.min(1,age/250,(4000-age)/350))};
 }
}
