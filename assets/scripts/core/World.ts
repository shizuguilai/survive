// ============================================================
// World：持有全部模拟状态，tick(dt) 按固定步长驱动所有系统
// 渲染层只读此处状态；输入层只通过本类方法修改状态
// ============================================================
import {
    BUILDINGS,
    DAY_LENGTH_SEC,
    MAP_H,
    MAP_W,
    START_SURVIVORS,
    SURVIVOR_DEFAULT,
    ZOMBIE_STATS,
} from "./Config";
import { GameMap } from "./GameMap";
import { Pathfinder } from "./Pathfinding";
import { ResourceStore } from "./ResourceStore";
import { Building, createBuilding } from "./Buildings";
import { createSurvivor, createZombie, Survivor, Zombie } from "./Entities";
import { BuildingType, JobType, ResourceType, Tile } from "./Types";

import { JobSystem } from "./systems/JobSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { BuildSystem } from "./systems/BuildSystem";
import { WaveSystem } from "./systems/WaveSystem";
import { PopulationSystem } from "./systems/PopulationSystem";

export class World {
    map: GameMap;
    pathfinder: Pathfinder;
    resources: ResourceStore;

    survivors: Survivor[] = [];
    zombies: Zombie[] = [];
    buildings: Building[] = [];

    /** 瓦片 -> 建筑 id（-1 表示空） */
    buildingGrid: Int32Array;
    /** 瓦片是否阻挡通行（墙），用于寻路 */
    blockGrid: Uint8Array;

    day = 1;
    dayTime = 0;
    totalTime = 0;
    gameSpeed = 1; // 由 GameRoot 控制 tick 次数；此处仅记录用于 UI

    housingCapacity = 0;
    waveDaySpawned = 0;
    reproTimer = 0;

    private _nextId = 1;

    /** 可选日志回调（给 UI 飘字用） */
    onLog: ((msg: string) => void) | null = null;

    constructor() {
        this.map = new GameMap(MAP_W, MAP_H);
        this.pathfinder = new Pathfinder(MAP_W, MAP_H);
        this.resources = new ResourceStore();
        this.buildingGrid = new Int32Array(MAP_W * MAP_H).fill(-1);
        this.blockGrid = new Uint8Array(MAP_W * MAP_H);
    }

    // ---------------- 初始化 ----------------
    init(seed = Date.now()): void {
        this.map.generate(seed);
        const c = this.center();

        // 初始资源，保证开局可建造
        this.resources.add(ResourceType.Wood, 80);
        this.resources.add(ResourceType.Stone, 40);
        this.resources.add(ResourceType.Food, 60);

        // 赠送一个已建成的仓库（否则采集无法入库）
        const wh = createBuilding(this.nextId(), BuildingType.Warehouse, c.col, c.row);
        wh.built = true;
        wh.buildProgress = BUILDINGS[BuildingType.Warehouse].buildTime;
        this.buildings.push(wh);
        this.buildingGrid[this.map.idx(c.col, c.row)] = wh.id;

        // 初始幸存者（围绕中心），分配默认职业
        const startJobs = [
            JobType.Lumberjack,
            JobType.Lumberjack,
            JobType.Worker,
            JobType.Worker,
            JobType.Scavenger,
        ];
        for (let i = 0; i < START_SURVIVORS; i++) {
            const angle = (i / START_SURVIVORS) * Math.PI * 2;
            const sx = c.col + 0.5 + Math.cos(angle) * 2;
            const sy = c.row + 0.5 + Math.sin(angle) * 2;
            const s = createSurvivor(this.nextId(), sx, sy, SURVIVOR_DEFAULT.health);
            s.job = startJobs[i % startJobs.length];
            this.survivors.push(s);
        }

        this.recomputeStats();
    }

    nextId(): number {
        return this._nextId++;
    }

    center(): Tile {
        return { col: Math.floor(MAP_W / 2), row: Math.floor(MAP_H / 2) };
    }

    // ---------------- 查询辅助 ----------------
    isWalkable = (col: number, row: number): boolean => {
        if (!this.map.isTerrainWalkable(col, row)) return false;
        return this.blockGrid[this.map.idx(col, row)] === 0;
    };

    findPath(start: Tile, goal: Tile): Tile[] | null {
        return this.pathfinder.find(start, goal, this.isWalkable);
    }

    getBuilding(id: number): Building | undefined {
        for (let i = 0; i < this.buildings.length; i++) {
            if (this.buildings[i].id === id) return this.buildings[i];
        }
        return undefined;
    }

    getSurvivor(id: number): Survivor | undefined {
        for (let i = 0; i < this.survivors.length; i++) {
            if (this.survivors[i].id === id) return this.survivors[i];
        }
        return undefined;
    }

    findNearestBuilding(
        col: number,
        row: number,
        pred: (b: Building) => boolean
    ): Building | null {
        let best: Building | null = null;
        let bestD = Infinity;
        for (const b of this.buildings) {
            if (!pred(b)) continue;
            const dc = b.col - col;
            const dr = b.row - row;
            const d = dc * dc + dr * dr;
            if (d < bestD) {
                bestD = d;
                best = b;
            }
        }
        return best;
    }

    get populationCount(): number {
        return this.survivors.length;
    }

    addResource(type: ResourceType, amount: number): number {
        return this.resources.add(type, amount);
    }

    // ---------------- 建造指令（输入层调用） ----------------
    canPlace(type: BuildingType, col: number, row: number): boolean {
        if (!this.map.isBuildableTerrain(col, row)) return false;
        if (this.buildingGrid[this.map.idx(col, row)] !== -1) return false;
        return this.resources.canAfford(BUILDINGS[type].cost);
    }

    placeBuilding(type: BuildingType, col: number, row: number): Building | null {
        if (!this.canPlace(type, col, row)) return null;
        this.resources.spend(BUILDINGS[type].cost);
        const b = createBuilding(this.nextId(), type, col, row);
        this.buildings.push(b);
        this.buildingGrid[this.map.idx(col, row)] = b.id;
        // 墙在建成后才阻挡通行
        return b;
    }

    /** 建筑建成时回调 */
    onBuildingBuilt(b: Building): void {
        if (BUILDINGS[b.type].blocksMovement) {
            this.blockGrid[this.map.idx(b.col, b.row)] = 1;
        }
        this.recomputeStats();
    }

    removeBuilding(b: Building): void {
        const i = this.buildings.indexOf(b);
        if (i >= 0) this.buildings.splice(i, 1);
        this.buildingGrid[this.map.idx(b.col, b.row)] = -1;
        this.blockGrid[this.map.idx(b.col, b.row)] = 0;
        this.recomputeStats();
    }

    /** 重算仓库上限、住房容量等派生数据 */
    recomputeStats(): void {
        let warehouses = 0;
        let housing = 0;
        for (const b of this.buildings) {
            if (!b.built) continue;
            if (b.type === BuildingType.Warehouse) warehouses++;
            const def = BUILDINGS[b.type];
            if (def.housing) housing += def.housing;
        }
        this.resources.setWarehouseCount(warehouses);
        this.housingCapacity = housing;
    }

    hasBarracks(): boolean {
        return this.buildings.some((b) => b.built && b.type === BuildingType.Barracks);
    }

    // ---------------- 生成实体 ----------------
    spawnSurvivor(col: number, row: number, job = JobType.Unassigned): Survivor {
        const s = createSurvivor(this.nextId(), col + 0.5, row + 0.5, SURVIVOR_DEFAULT.health);
        s.job = job;
        this.survivors.push(s);
        return s;
    }

    spawnZombie(col: number, row: number): Zombie {
        const z = createZombie(this.nextId(), col + 0.5, row + 0.5, ZOMBIE_STATS.health);
        this.zombies.push(z);
        return z;
    }

    // ---------------- 主循环 ----------------
    tick(dt: number): void {
        this.totalTime += dt;
        this.dayTime += dt;
        if (this.dayTime >= DAY_LENGTH_SEC) {
            this.dayTime -= DAY_LENGTH_SEC;
            this.day++;
        }

        WaveSystem.update(this, dt);
        JobSystem.update(this, dt);
        CombatSystem.update(this, dt);
        BuildSystem.update(this, dt);
        PopulationSystem.update(this, dt);

        this.cleanupDead();
    }

    private cleanupDead(): void {
        for (let i = this.survivors.length - 1; i >= 0; i--) {
            if (this.survivors[i].health <= 0) this.survivors.splice(i, 1);
        }
        for (let i = this.zombies.length - 1; i >= 0; i--) {
            if (this.zombies[i].health <= 0) this.zombies.splice(i, 1);
        }
        for (let i = this.buildings.length - 1; i >= 0; i--) {
            if (this.buildings[i].hp <= 0) {
                this.removeBuilding(this.buildings[i]);
            }
        }
    }

    /** 剩余到下一波（天）的秒数 */
    get timeToNextDay(): number {
        return DAY_LENGTH_SEC - this.dayTime;
    }
}
