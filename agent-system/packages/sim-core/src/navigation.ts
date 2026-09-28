import type {Vec3} from '../../contracts/src/types.ts';
import type {World,WorldObject,Resident} from './domain.ts';

const wallCache=new WeakMap<WorldObject,{key:string;walls:WorldObject[]}>();const EMPTY:WorldObject[]=[];
/** These dimensions match the house mesh, including the 1.4-unit south doorway. */
export function solidWalls(object:WorldObject):WorldObject[]{
  if(object.kind!=='wall'&&(!['house','plot'].includes(object.kind)||(object.buildStage??3)<2))return EMPTY;
  const key=[object.kind,object.buildStage,object.position.x,object.position.y,object.position.z,object.width,object.depth].join(':');const cached=wallCache.get(object);if(cached?.key===key)return cached.walls;
  const walls:WorldObject[]=object.kind==='wall'?[object]: [[0,-1.45,4,.18],[-1.92,0,.16,3],[1.92,0,.16,3],[-1.35,1.45,1.3,.17],[1.35,1.45,1.3,.17]].map(([x,z,width,depth],i)=>({
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
export const movementBlocked=(w:World,a:Vec3,b:Vec3)=>w.objects.some(o=>solidWalls(o).some(wall=>crossesWall(a,b,wall)));
export function floorHeight(w:World,p:Vec3):number{
  for(const o of w.objects)if(['house','plot'].includes(o.kind)&&(o.buildStage??3)>=1){
    const x=Math.abs(p.x-o.position.x),z=p.z-o.position.z;
    if(x<1.8&&Math.abs(z)<1.6)return .405;
    if(x<.6&&z>=1.6&&z<2.4)return .405*(2.4-z)/.8;
  }
  return 0;
}
/** Path planning uses personally known buildings only; actual collision is always checked. */
export function navigationPath(w:World,r:Resident,target:Vec3):Vec3[]{
  const known=new Set(Object.values(r.known).map(k=>k.entityId));
  const houses=w.objects.filter(o=>['house','plot'].includes(o.kind)&&(known.has(o.id)||known.has(o.projectId??'')));
  const walls=houses.flatMap(solidWalls);
  const clear=(a:Vec3,b:Vec3)=>!walls.some(o=>crossesWall(a,b,o));
  if(clear(r.position,target))return [{...target}];
  const nodes=[{...r.position},{...target}];
  for(const wall of walls)for(const x of [-1,1])for(const z of [-1,1]){
    const p={x:wall.position.x+x*(wall.width/2+.45),y:0,z:wall.position.z+z*(wall.depth/2+.45)};
    if(clear(p,p))nodes.push(p);
  }
  const costs=nodes.map(()=>Infinity),parent=nodes.map(()=>-1),seen=new Set<number>();costs[0]=0;
  for(let count=0;count<nodes.length;count++){
    let i=-1;for(let n=0;n<nodes.length;n++)if(!seen.has(n)&&(i<0||costs[n]<costs[i]))i=n;
    if(i<0||!Number.isFinite(costs[i]))break;if(i===1){const path:Vec3[]=[];for(let at=1;at>0;at=parent[at])path.unshift(nodes[at]);return path;}
    seen.add(i);for(let n=0;n<nodes.length;n++)if(!seen.has(n)&&clear(nodes[i],nodes[n])){
      const cost=costs[i]+Math.hypot(nodes[i].x-nodes[n].x,nodes[i].z-nodes[n].z);if(cost<costs[n]){costs[n]=cost;parent[n]=i;}
    }
  }
  return [{...target}]; // The real contact check produces a private obstruction event.
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
