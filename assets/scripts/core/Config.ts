// ============================================================
// 全部平衡数值集中在此，方便调参
// ============================================================
import { BuildingType, JobType, ResourceType } from "./Types";

export const MAP_W = 100;
export const MAP_H = 100;
export const TILE = 32; // 像素

/** 模拟固定步长（秒）。渲染与逻辑解耦 */
export const TICK_DT = 1 / 20; // 20 次/秒

/** 一天的真实秒数（影响尸潮节奏） */
export const DAY_LENGTH_SEC = 45;

/** 幸存者默认属性 */
export const SURVIVOR_DEFAULT = {
    health: 100,
    moveSpeed: 2.2, // 瓦片/秒
    attack: 8,
    defense: 0,
};

/** 僵尸属性 */
export const ZOMBIE_STATS = {
    health: 30,
    attack: 5,
    speed: 0.8, // 瓦片/秒
    defense: 0,
};

/** 道路移动加速倍率 */
export const ROAD_SPEED_MULT = 1.5;

/** 资源基础上限（无仓库时） */
export const BASE_RESOURCE_CAP = 200;
/** 每个仓库增加的上限 */
export const WAREHOUSE_CAP_BONUS = 500;

/** 采集相关 */
export const GATHER = {
    workTime: 2.5, // 采集一次耗时（秒）
    carryAmount: 10, // 单次携带量
    huntTime: 3.5,
    huntAmount: 12,
    scavengeTime: 4,
};

/** 农场每秒产出食物 */
export const FARM_FOOD_PER_SEC = 1.2;

/** 人口增长 */
export const REPRO = {
    interval: 120, // 秒
    foodFactor: 3, // Food > Population * 3
    minPopulation: 2,
};

/** 攻击间隔（秒） */
export const ATTACK_COOLDOWN = 1.0;

/** 建筑定义 */
export interface BuildingDef {
    name: string;
    cost: Partial<Record<ResourceType, number>>;
    hp: number;
    housing?: number; // 提供人口容量
    buildTime: number; // 建造耗时（秒，Worker 在场时累加）
    blocksMovement?: boolean; // 是否阻挡通行（墙）
    attackRange?: number; // 塔楼攻击距离（瓦片）
    attackDamage?: number;
    unlocksSoldier?: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
    [BuildingType.Tent]: {
        name: "帐篷",
        cost: { [ResourceType.Wood]: 20 },
        hp: 120,
        housing: 2,
        buildTime: 4,
    },
    [BuildingType.House]: {
        name: "房屋",
        cost: { [ResourceType.Wood]: 50, [ResourceType.Stone]: 20 },
        hp: 300,
        housing: 5,
        buildTime: 8,
    },
    [BuildingType.Farm]: {
        name: "农场",
        cost: { [ResourceType.Wood]: 30 },
        hp: 150,
        buildTime: 6,
    },
    [BuildingType.Warehouse]: {
        name: "仓库",
        cost: { [ResourceType.Wood]: 40, [ResourceType.Stone]: 20 },
        hp: 250,
        buildTime: 7,
    },
    [BuildingType.Wall]: {
        name: "城墙",
        cost: { [ResourceType.Stone]: 10 },
        hp: 500,
        buildTime: 3,
        blocksMovement: true,
    },
    [BuildingType.WatchTower]: {
        name: "瞭望塔",
        cost: { [ResourceType.Wood]: 40, [ResourceType.Stone]: 20 },
        hp: 200,
        buildTime: 8,
        attackRange: 6,
        attackDamage: 10,
    },
    [BuildingType.Barracks]: {
        name: "兵营",
        cost: { [ResourceType.Wood]: 80, [ResourceType.Stone]: 40 },
        hp: 350,
        buildTime: 10,
        unlocksSoldier: true,
    },
};

/** 尸潮日程：返回某天的僵尸数量 */
export function zombiesForDay(day: number): number {
    if (day <= 0) return 0;
    if (day < 3) return 20;
    if (day < 5) return 50;
    if (day < 10) return 100;
    if (day < 15) return 200;
    if (day < 20) return 500;
    return day * 40;
}

/** 初始幸存者数量 */
export const START_SURVIVORS = 5;
