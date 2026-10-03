import type {World,ResidentialBounds,Resident,WorldObject} from './domain.ts';
import {designedHomeSize} from './home-design.ts';
export function zoneBounds(a:{x:number;z:number},b:{x:number;z:number}):ResidentialBounds{
  return {minX:Math.max(-27,Math.floor(Math.min(a.x,b.x))),maxX:Math.min(27,Math.ceil(Math.max(a.x,b.x))),minZ:Math.max(-27,Math.floor(Math.min(a.z,b.z))),maxZ:Math.min(27,Math.ceil(Math.max(a.z,b.z)))};
}
export function validateZone(bounds:ResidentialBounds):string|null{
  if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite))return '请在地图上拖出有效的居住区';
  if(bounds.minX < -27||bounds.maxX > 27||bounds.minZ < -27||bounds.maxZ > 27)return '居住区必须位于地图内';
  if(bounds.maxX-bounds.minX<6||bounds.maxZ-bounds.minZ<6)return '区域至少需要6×6格，给小屋和出入口留出空间';
  return null;
}
/** Repainting existing residential land does not create another notice or zone. */
export function zoneCoveredBy(bounds:ResidentialBounds,existing:ResidentialBounds[]):boolean{
  const overlapping=existing.filter(b=>b.minX<bounds.maxX&&b.maxX>bounds.minX&&b.minZ<bounds.maxZ&&b.maxZ>bounds.minZ);
  const edges=[...new Set([bounds.minX,bounds.maxX,...overlapping.flatMap(b=>[Math.max(bounds.minX,b.minX),Math.min(bounds.maxX,b.maxX)])])].sort((a,b)=>a-b);
  for(let i=1;i<edges.length;i++){
    const spans=overlapping.filter(b=>b.minX<=edges[i-1]&&b.maxX>=edges[i]).sort((a,b)=>a.minZ-b.minZ);
    let coveredTo=bounds.minZ;
    for(const span of spans){
      if(span.minZ>coveredTo)break;
      coveredTo=Math.max(coveredTo,span.maxZ);
      if(coveredTo>=bounds.maxZ)break;
    }
    if(coveredTo<bounds.maxZ)return false;
  }
  return true;
}
/** Includes a front approach lane and separation from other houses and scenery. */
export function homeSites(world:World,b:ResidentialBounds,size={width:4,depth:3},ignoreId?:string):{x:number;z:number}[]{
  const sites:{x:number;z:number}[]=[];
  // Fine search finds gaps between differently sized homes; pack the returned
  // candidates so the observer's estimate still describes separate lots.
  for(let z=b.minZ+size.depth/2+.7;z<=b.maxZ-size.depth/2-1.7;z+=1)for(let x=b.minX+size.width/2+.6;x<=b.maxX-size.width/2-.6;x+=1){
    if(sites.some(p=>Math.abs(p.x-x)<size.width+1.2&&Math.abs(p.z-z)<size.depth+3))continue;
    if(!homeFits(world,b,{x,z},size,ignoreId))continue;
    sites.push({x,z});
  }
  return sites;
}
export const ownHomeProject=(w:World,r:Resident)=>w.camp?.tasks.find(t=>t.kind==='house'&&t.ownerId===r.id&&t.status==='open');

export function homeFits(w:World,b:ResidentialBounds,p:{x:number;z:number},size:{width:number;depth:number},ignoreId?:string):boolean{
 if(p.x-size.width/2-.6<b.minX||p.x+size.width/2+.6>b.maxX||p.z-size.depth/2-.7<b.minZ||p.z+size.depth/2+1.7>b.maxZ)return false;
 if(w.camp?.tasks.some(t=>{if(!t.renovation||t.status!=='open'||!t.targetPosition||ignoreId&&w.objects.find(o=>o.projectId===t.id)?.id===ignoreId)return false;const reserved=designedHomeSize(t.homeLevel,t.homeDesign);return Math.abs(t.targetPosition.x-p.x)<size.width/2+reserved.width/2+1.2&&Math.abs(t.targetPosition.z-p.z)<size.depth/2+reserved.depth/2+2.4;}))return false;
 return !w.objects.some(o=>{
  if(o.id===ignoreId||(o.resourceKind&&o.resources<=0))return false;
  if(['house','plot'].includes(o.kind))return Math.abs(o.position.x-p.x)<(size.width+o.width)/2+1.2&&Math.abs(o.position.z-p.z)<(size.depth+o.depth)/2+2.4;
  const ow=Math.max(o.width,o.kind==='tree'?2.2:1),od=Math.max(o.depth,1);
  return Math.abs(o.position.x-p.x)<size.width/2+.6+ow/2&&o.position.z+od/2>p.z-size.depth/2-.7&&o.position.z-od/2<p.z+size.depth/2+1.7;
 });
}
