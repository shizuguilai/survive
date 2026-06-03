// ============================================================
// 实体数据模型：幸存者 / 僵尸
// ============================================================
import { EntityState, JobType, ResourceType, Tile } from "./Types";

export interface Survivor {
    id: number;
    x: number; // 浮点列坐标
    y: number; // 浮点行坐标
    health: number;
    maxHealth: number;
    age: number;
    job: JobType;
    state: EntityState;
    path: Tile[]; // 当前路径（瓦片列表）
    pathIndex: number;
    // 携带的资源（采集后搬运回仓库）
    carryType: ResourceType | -1;
    carryAmount: number;
    workTimer: number; // 当前工作累计时间
    attackCooldown: number;
    targetTile: Tile | null; // 目标瓦片（采集点/建造点）
    targetId: number; // 目标建筑/敌人 id（-1 无）
}

export interface Zombie {
    id: number;
    x: number;
    y: number;
    health: number;
    state: EntityState;
    path: Tile[];
    pathIndex: number;
    attackCooldown: number;
    targetId: number; // 目标建筑/幸存者 id
    targetIsBuilding: boolean;
    repathTimer: number;
}

export function createSurvivor(id: number, x: number, y: number, maxHealth: number): Survivor {
    return {
        id,
        x,
        y,
        health: maxHealth,
        maxHealth,
        age: 0,
        job: JobType.Unassigned,
        state: EntityState.Idle,
        path: [],
        pathIndex: 0,
        carryType: -1,
        carryAmount: 0,
        workTimer: 0,
        attackCooldown: 0,
        targetTile: null,
        targetId: -1,
    };
}

export function createZombie(id: number, x: number, y: number, health: number): Zombie {
    return {
        id,
        x,
        y,
        health,
        state: EntityState.Moving,
        path: [],
        pathIndex: 0,
        attackCooldown: 0,
        targetId: -1,
        targetIsBuilding: true,
        repathTimer: 0,
    };
}
