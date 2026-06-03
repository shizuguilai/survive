// ============================================================
// JobSystem：幸存者按职业自动工作
// 采集 -> 搬运入仓 / 建造 / 农场 / 打猎 / 探索废墟
// 士兵、狙击手由 CombatSystem 处理
// ============================================================
import { GATHER, SURVIVOR_DEFAULT } from "../Config";
import { Survivor } from "../Entities";
import { BuildingType, EntityState, JobType, ResourceType, TerrainType, Tile } from "../Types";
import { entityTile, moveAlongPath, setPath } from "./MovementSystem";
import type { World } from "../World";

const SPEED = SURVIVOR_DEFAULT.moveSpeed;

type NodeFinder = (world: World, s: Survivor) => Tile | null;
type ResourcePicker = () => ResourceType;

export class JobSystem {
    static update(world: World, dt: number): void {
        for (const s of world.survivors) {
            if (s.health <= 0) continue;
            switch (s.job) {
                case JobType.Lumberjack:
                    gather(world, s, dt, findForest, () => ResourceType.Wood, GATHER.workTime, GATHER.carryAmount);
                    break;
                case JobType.Worker:
                    worker(world, s, dt);
                    break;
                case JobType.Farmer:
                    farmer(world, s, dt);
                    break;
                case JobType.Hunter:
                    gather(world, s, dt, findEdge, () => ResourceType.Food, GATHER.huntTime, GATHER.huntAmount);
                    break;
                case JobType.Scavenger:
                    gather(world, s, dt, findRuin, pickRuinResource, GATHER.scavengeTime, GATHER.carryAmount);
                    break;
                case JobType.Soldier:
                case JobType.Sniper:
                    // 战斗逻辑在 CombatSystem
                    break;
                default:
                    s.state = EntityState.Idle;
                    break;
            }
        }
    }
}

// ---------------- 采集 + 搬运通用流程 ----------------
function gather(
    world: World,
    s: Survivor,
    dt: number,
    findNode: NodeFinder,
    pick: ResourcePicker,
    workTime: number,
    amount: number
): void {
    // 身上有货 -> 回仓
    if (s.carryAmount > 0) {
        haul(world, s, dt);
        return;
    }

    // 找采集点
    if (!s.targetTile) {
        const node = findNode(world, s);
        if (!node) {
            s.state = EntityState.Idle;
            return;
        }
        const path = world.findPath(entityTile(s), node);
        if (!path) {
            s.state = EntityState.Idle;
            return;
        }
        s.targetTile = node;
        setPath(s, path);
    }

    // 前往采集点
    if (s.pathIndex < s.path.length) {
        s.state = EntityState.Moving;
        moveAlongPath(world.map, s, SPEED, dt);
        return;
    }

    // 到达，开始采集
    s.state = EntityState.Working;
    s.workTimer += dt;
    if (s.workTimer >= workTime) {
        s.carryType = pick();
        s.carryAmount = amount;
        s.workTimer = 0;
        s.targetTile = null;
        s.path = [];
        s.pathIndex = 0;
    }
}

function haul(world: World, s: Survivor, dt: number): void {
    const t = entityTile(s);
    const wh = world.findNearestBuilding(t.col, t.row, (b) => b.built && isWarehouse(b.type));
    if (!wh) {
        // 没有仓库，资源无法入库，丢弃
        s.carryAmount = 0;
        s.carryType = -1;
        s.state = EntityState.Idle;
        return;
    }
    if (s.targetId !== wh.id || s.path.length === 0) {
        const path = world.findPath(t, { col: wh.col, row: wh.row });
        if (!path) {
            s.carryAmount = 0;
            s.carryType = -1;
            s.state = EntityState.Idle;
            return;
        }
        s.targetId = wh.id;
        setPath(s, path);
    }

    s.state = EntityState.Hauling;
    const reached = moveAlongPath(world.map, s, SPEED, dt);
    if (reached) {
        if (s.carryType >= 0) world.addResource(s.carryType as ResourceType, s.carryAmount);
        s.carryAmount = 0;
        s.carryType = -1;
        s.targetId = -1;
        s.path = [];
        s.pathIndex = 0;
        s.state = EntityState.Idle;
    }
}

// ---------------- Worker：优先建造，否则采石 ----------------
function worker(world: World, s: Survivor, dt: number): void {
    if (s.carryAmount > 0) {
        haul(world, s, dt);
        return;
    }
    const t = entityTile(s);
    const site = world.findNearestBuilding(t.col, t.row, (b) => !b.built);
    if (site) {
        if (s.targetId !== site.id) {
            const path = world.findPath(t, { col: site.col, row: site.row });
            s.targetId = site.id;
            setPath(s, path || []);
        }
        if (s.pathIndex < s.path.length) {
            s.state = EntityState.Moving;
            moveAlongPath(world.map, s, SPEED, dt);
        } else {
            // 在工地，BuildSystem 据此累加进度
            s.state = EntityState.Building;
        }
        return;
    }
    // 无建造任务 -> 采石
    s.targetId = -1;
    gather(world, s, dt, findStone, () => ResourceType.Stone, GATHER.workTime, GATHER.carryAmount);
}

// ---------------- Farmer：在农场工作 ----------------
function farmer(world: World, s: Survivor, dt: number): void {
    const t = entityTile(s);
    const farm = world.findNearestBuilding(t.col, t.row, (b) => b.built && b.type === BuildingType.Farm);
    if (!farm) {
        s.state = EntityState.Idle;
        return;
    }
    if (s.targetId !== farm.id) {
        const path = world.findPath(t, { col: farm.col, row: farm.row });
        s.targetId = farm.id;
        setPath(s, path || []);
    }
    if (s.pathIndex < s.path.length) {
        s.state = EntityState.Moving;
        moveAlongPath(world.map, s, SPEED, dt);
    } else {
        s.state = EntityState.Working; // BuildSystem 据此产粮
    }
}

// ---------------- 采集点查找 ----------------
function findForest(world: World, s: Survivor): Tile | null {
    const t = entityTile(s);
    return world.map.findNearestTerrain(t.col, t.row, TerrainType.Forest, 45);
}
function findStone(world: World, s: Survivor): Tile | null {
    const t = entityTile(s);
    return world.map.findNearestTerrain(t.col, t.row, TerrainType.Stone, 45);
}
function findRuin(world: World, s: Survivor): Tile | null {
    const t = entityTile(s);
    return world.map.findNearestTerrain(t.col, t.row, TerrainType.Ruin, 60);
}
function findEdge(world: World, s: Survivor): Tile | null {
    const t = entityTile(s);
    const w = world.map.width;
    const h = world.map.height;
    const dl = t.col;
    const dr = w - 1 - t.col;
    const dt2 = t.row;
    const db = h - 1 - t.row;
    const m = Math.min(dl, dr, dt2, db);
    let col = t.col;
    let row = t.row;
    if (m === dl) col = 1;
    else if (m === dr) col = w - 2;
    else if (m === dt2) row = 1;
    else row = h - 2;
    if (!world.isWalkable(col, row)) {
        return world.map.findNearestTerrain(col, row, TerrainType.Grass, 12);
    }
    return { col, row };
}

function pickRuinResource(): ResourceType {
    const r = Math.random();
    if (r < 0.35) return ResourceType.Wood;
    if (r < 0.6) return ResourceType.Stone;
    if (r < 0.8) return ResourceType.Food;
    return ResourceType.Metal;
}

function isWarehouse(type: number): boolean {
    return type === BuildingType.Warehouse;
}
