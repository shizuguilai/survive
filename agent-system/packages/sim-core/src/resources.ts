import type {WorldObject} from './domain.ts';
export function resourceCapacity(o:WorldObject):number{return o.maxResources??(o.id.startsWith('tree-')?30:o.kind==='berry'?12:24);}
export function resourceRatio(o:WorldObject):number{return Math.max(0,Math.min(1,o.resources/Math.max(1,resourceCapacity(o))));}
export function resourceStage(o:WorldObject):number{return o.resources<=0?0:Math.ceil(resourceRatio(o)*4);}
