import type {Vec3} from '../../contracts/src/types.ts';
import type {World,WorldObject,Resident} from './domain.ts';

const wallCache=new WeakMap<WorldObject,{key:string;walls:WorldObject[]}>();const EMPTY:WorldObject[]=[];
/** These dimensions match the house mesh, including the 1.4-unit south doorway. */
export function solidWalls(object:WorldObject):WorldObject[]{
  if(object.kind!=='wall'&&(!['house','plot'].includes(object.kind)||(object.buildStage??3)<2))return EMPTY;
  const key=[object.kind,object.buildStage,object.position.x,object.position.y,object.position.z,object.width,object.depth].join(':');const cached=wallCache.get(object);if(cached?.key===key)return cached.walls;
  const hw=object.width/2,hd=object.depth/2,side=(object.width-1.4)/2,front=(hw+.7)/2;
  const walls:WorldObject[]=object.kind==='wall'?[object]: [[0,-hd+.05,object.width,.18],[-hw+.08,0,.16,object.depth],[hw-.08,0,.16,object.depth],[-front,hd-.05,side,.17],[front,hd-.05,side,.17]].map(([x,z,width,depth],i)=>({
    ...object,id:`${object.id}:wall:${i}`,kind:'wall',position:{x:object.position.x+x,y:.37,z:object.position.z+z},width,depth,height:2.1,
  }));wallCache.set(object,{key,walls});return walls;
}
export function crossesWall(a:Vec3,b:Vec3,o:WorldObject,padding=.42):boolean{
  let lo=0,hi=1;
  for(const axis of ['x','z'] as const){
    const half=(axis==='x'?o.width:o.depth)/2+padding,min=o.position[axis]-half,max=o.position[axis]+half,d=b[axis]-a[axis];
    if(Math.abs(d)<1e-9){if(a[axis]<min||a[axis]>max)return false;}
    else{const p=(min-a[axis])/d,q=(max-a[axis])/d;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));if(lo>hi)return false;}
  }
  return hi>=0&&lo<=1;
}
/** The pond's painted footprint and native water are circular (the legacy depth is smaller). */
export const POND_CLEARANCE=.6;
export const pondWaterRadius=(pond:WorldObject)=>Math.max(pond.width,pond.depth)/2;
export const pondCollisionRadius=(pond:WorldObject)=>pondWaterRadius(pond)+POND_CLEARANCE;
const pondDistanceSquared=(p:Vec3,pond:WorldObject)=>(p.x-pond.position.x)**2+(p.z-pond.position.z)**2;
export function insidePond(p:Vec3,pond:WorldObject):boolean{return pond.kind==='pond'&&pondDistanceSquared(p,pond)<pondCollisionRadius(pond)**2;}
/** Swept-body contact, so even long steps cannot tunnel through water. Old water positions may only move outwards. */
export function crossesPond(a:Vec3,b:Vec3,pond:WorldObject,allowEscape=false):boolean{
  if(pond.kind!=='pond')return false;
  const x=a.x-pond.position.x,z=a.z-pond.position.z,dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz,r2=pondCollisionRadius(pond)**2;
  if(allowEscape&&x*x+z*z<r2&&d2>1e-12&&x*dx+z*dz>=-1e-10&&pondDistanceSquared(b,pond)>x*x+z*z+1e-12)return false;
  const t=d2>1e-12?Math.max(0,Math.min(1,-(x*dx+z*dz)/d2)):0;
  return (x+t*dx)**2+(z+t*dz)**2<r2;
}
/** A stable dry shoreline destination for walking, resting or collecting water. */
export function pondApproachPoint(pond:WorldObject,from:Vec3):Vec3{
  const x=from.x-pond.position.x,z=from.z-pond.position.z,d=Math.hypot(x,z),radius=pondCollisionRadius(pond)+.12;
  return {x:pond.position.x+(d>1e-9?x/d:0)*radius,y:0,z:pond.position.z+(d>1e-9?z/d:1)*radius};
}
export const movementBlocked=(w:World,a:Vec3,b:Vec3)=>w.objects.some(o=>crossesPond(a,b,o,true)||solidWalls(o).some(wall=>crossesWall(a,b,wall)));
function knownObstacles(w:World,r:Resident):WorldObject[]{
  const known=new Set(Object.values(r.known).map(k=>k.entityId));
  return w.objects.filter(o=>['wall','house','plot','pond'].includes(o.kind)&&(known.has(o.id)||known.has(o.projectId??'')));
}
/** Resolve personally known water targets once at action start; never walk towards the submerged centre. */
export function walkDestination(w:World,r:Resident,target:Vec3):Vec3{
  const pond=knownObstacles(w,r).find(o=>insidePond(target,o));
  if(!pond)return {...target};
  const shore=pondApproachPoint(pond,r.position);
  // Walk actions normally stop .8 before the destination. A legacy resident already
  // in water needs that extra distance to finish on dry land, rather than stop short.
  if(insidePond(r.position,pond)){
    const dx=shore.x-pond.position.x,dz=shore.z-pond.position.z,d=Math.hypot(dx,dz);
    shore.x+=dx/d*.8;shore.z+=dz/d*.8;
  }
  return shore;
}
/** A newly observed obstacle invalidates an old direct path without revealing unseen obstacles. */
export function navigationKey(w:World,r:Resident):string{
  return knownObstacles(w,r).map(o=>[o.id,o.kind,o.buildStage,o.width,o.depth,o.position.x,o.position.z].join(':')).join('|');
}
export function floorHeight(w:World,p:Vec3):number{
  for(const o of w.objects)if(['house','plot'].includes(o.kind)&&(o.buildStage??3)>=1){
    const x=Math.abs(p.x-o.position.x),z=p.z-o.position.z;
    if(x<o.width/2-.2&&Math.abs(z)<o.depth/2+.1)return .405;
    if(x<.6&&z>=o.depth/2+.1&&z<o.depth/2+.9)return .405*(o.depth/2+.9-z)/.8;
  }
  return 0;
}
/** Paths use personally known obstacles. Contact always checks real water and walls. */
export function navigationPath(w:World,r:Resident,target:Vec3):Vec3[]{
  const obstacles=knownObstacles(w,r),walls=obstacles.flatMap(solidWalls);
  const ponds=obstacles.filter(o=>o.kind==='pond');
  // A pre-fix save can begin in water. Bodily contact permits a gradual outward escape,
  // but does not reveal any other unobserved pond or allow crossing deeper through this one.
  for(const pond of w.objects)if(insidePond(r.position,pond)&&!ponds.includes(pond))ponds.push(pond);
  const destination=walkDestination(w,r,target);
  const clear=(a:Vec3,b:Vec3)=>!walls.some(o=>crossesWall(a,b,o))&&!ponds.some(o=>crossesPond(a,b,o,true));
  if(clear(r.position,destination))return [destination];
  const nodes=[{...r.position},destination];
  for(const wall of walls)for(const x of [-1,1])for(const z of [-1,1]){
    const p={x:wall.position.x+x*(wall.width/2+.45),y:0,z:wall.position.z+z*(wall.depth/2+.45)};
    if(clear(p,p))nodes.push(p);
  }
  for(const pond of ponds){
    // The circumscribed ring keeps straight chords outside the padded water boundary.
    const radius=pondCollisionRadius(pond)/Math.cos(Math.PI/16)+.04;
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8,p={x:pond.position.x+Math.cos(a)*radius,y:0,z:pond.position.z+Math.sin(a)*radius};
      if(clear(p,p))nodes.push(p);
    }
    const shore=pondApproachPoint(pond,r.position);if(clear(shore,shore))nodes.push(shore);
  }
  const costs=nodes.map(()=>Infinity),parent=nodes.map(()=>-1),seen=new Set<number>();costs[0]=0;
  for(let count=0;count<nodes.length;count++){
    let i=-1;for(let n=0;n<nodes.length;n++)if(!seen.has(n)&&(i<0||costs[n]<costs[i]))i=n;
    if(i<0||!Number.isFinite(costs[i]))break;if(i===1){const path:Vec3[]=[];for(let at=1;at>0;at=parent[at])path.unshift(nodes[at]);return path;}
    seen.add(i);for(let n=0;n<nodes.length;n++)if(!seen.has(n)&&clear(nodes[i],nodes[n])){
      const cost=costs[i]+Math.hypot(nodes[i].x-nodes[n].x,nodes[i].z-nodes[n].z);if(cost<costs[n]){costs[n]=cost;parent[n]=i;}
    }
  }
  return [destination]; // The real contact check produces a private obstruction event.
}
/** Newly completed walls cannot enclose a builder's body inside the wall slab. */
export function clearNewWalls(w:World,o:WorldObject):void{
  const walls=solidWalls(o);for(const r of w.residents){
    if(walls.some(b=>crossesWall(r.position,r.position,b))){
      const candidates=walls.flatMap(b=>[
        {...r.position,x:b.position.x-b.width/2-.45},{...r.position,x:b.position.x+b.width/2+.45},
        {...r.position,z:b.position.z-b.depth/2-.45},{...r.position,z:b.position.z+b.depth/2+.45},
      ]).filter(p=>!movementBlocked(w,p,p)).sort((a,b)=>Math.hypot(a.x-r.position.x,a.z-r.position.z)-Math.hypot(b.x-r.position.x,b.z-r.position.z));
      if(candidates[0])r.position=candidates[0];
    }
    r.position.y=floorHeight(w,r.position);
  }
}
