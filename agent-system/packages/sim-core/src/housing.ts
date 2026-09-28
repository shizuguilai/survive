import type {World,ResidentialBounds,Resident} from './domain.ts';
export function zoneBounds(a:{x:number;z:number},b:{x:number;z:number}):ResidentialBounds{
  return {minX:Math.max(-27,Math.floor(Math.min(a.x,b.x))),maxX:Math.min(27,Math.ceil(Math.max(a.x,b.x))),minZ:Math.max(-27,Math.floor(Math.min(a.z,b.z))),maxZ:Math.min(27,Math.ceil(Math.max(a.z,b.z)))};
}
export function validateZone(bounds:ResidentialBounds):string|null{
  if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite))return '请在地图上拖出有效的居住区';
  if(bounds.minX < -27||bounds.maxX > 27||bounds.minZ < -27||bounds.maxZ > 27)return '居住区必须位于地图内';
  if(bounds.maxX-bounds.minX<6||bounds.maxZ-bounds.minZ<6)return '区域至少需要6×6格，给小屋和出入口留出空间';
  return null;
}
/** Includes a front approach lane and separation from other houses and scenery. */
export function homeSites(world:World,b:ResidentialBounds):{x:number;z:number}[]{
  const sites:{x:number;z:number}[]=[];
  for(let z=b.minZ+2.2;z<=b.maxZ-3.2;z+=6)for(let x=b.minX+2.6;x<=b.maxX-2.6;x+=5.8){
    if(world.objects.some(o=>{
      if(o.resourceKind&&o.resources<=0)return false;
      const building=['house','plot'].includes(o.kind);
      const w=building?5.2:Math.max(o.width,o.kind==='tree'?2.2:1),d=building?5.5:Math.max(o.depth,1);
      return Math.abs(o.position.x-x)<2.6+w/2&&o.position.z+d/2>z-2.2&&o.position.z-d/2<z+3.2;
    }))continue;
    sites.push({x,z});
  }
  return sites;
}
export const ownHomeProject=(w:World,r:Resident)=>w.camp?.tasks.find(t=>t.kind==='house'&&t.ownerId===r.id);
