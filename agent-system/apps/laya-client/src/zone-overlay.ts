import type {ResidentialBounds} from '../../../packages/sim-core/src/domain.ts';

type Point={x:number;z:number};
/** Exact rectangle union for one fill per point and no borders inside overlaps. */
export function zoneOverlayGeometry(bounds:ResidentialBounds[]):{fills:ResidentialBounds[];edges:[Point,Point][]}{
 const xs=[...new Set(bounds.flatMap(b=>[b.minX,b.maxX]))].sort((a,b)=>a-b),zs=[...new Set(bounds.flatMap(b=>[b.minZ,b.maxZ]))].sort((a,b)=>a-b);
 const rows=zs.slice(0,-1).map((z,j)=>xs.slice(0,-1).map((x,i)=>bounds.some(b=>(x+xs[i+1])/2>b.minX&&(x+xs[i+1])/2<b.maxX&&(z+zs[j+1])/2>b.minZ&&(z+zs[j+1])/2<b.maxZ)));
 const fills:ResidentialBounds[]=[],edges:[Point,Point][]=[];
 for(let j=0;j<rows.length;j++){
  let start=-1;
  for(let i=0;i<=rows[j].length;i++){
   const covered=rows[j][i]??false;
   if(covered&&start<0)start=i;
   if(!covered&&start>=0){fills.push({minX:xs[start],maxX:xs[i],minZ:zs[j],maxZ:zs[j+1]});start=-1;}
   if(!covered)continue;
   const x=xs[i],r=xs[i+1],z=zs[j],f=zs[j+1];
   if(!rows[j][i-1])edges.push([{x,z},{x,z:f}]);
   if(!rows[j][i+1])edges.push([{x:r,z},{x:r,z:f}]);
   if(!rows[j-1]?.[i])edges.push([{x,z},{x:r,z}]);
   if(!rows[j+1]?.[i])edges.push([{x,z:f},{x:r,z:f}]);
  }
 }
 return {fills,edges};
}
