// ============================================================
// 全局枚举与接口（纯数据，不依赖 Cocos）
// ============================================================

export enum TerrainType {
    Grass = 0, // 可建设
    Forest = 1, // 提供木材
    Stone = 2, // 提供石材
    Water = 3, // 不可通行
    Ruin = 4, // 探索获得资源
    Road = 5, // 移动加速
}

export enum ResourceType {
    Wood = 0,
    Stone = 1,
    Food = 2,
    Metal = 3,
}

export enum JobType {
    Unassigned = 0,
    Worker = 1, // 建造
    Lumberjack = 2, // 伐木
    Farmer = 3, // 农场
    Hunter = 4, // 打猎
    Scavenger = 5, // 探索废墟
    Soldier = 6, // 近战
    Sniper = 7, // 远程
}

export enum EntityState {
    Idle = 0,
    Moving = 1,
    Working = 2,
    Building = 3,
    Hauling = 4, // 搬运资源回仓
    Fighting = 5,
    Sleeping = 6,
    Dead = 7,
}

export enum BuildingType {
    Tent = 0,
    House = 1,
    Farm = 2,
    Warehouse = 3,
    Wall = 4,
    WatchTower = 5,
    Barracks = 6,
}

/** 瓦片坐标（整数列/行） */
export interface Tile {
    col: number;
    row: number;
}

/** 浮点位置（以瓦片为单位，便于平滑移动） */
export interface PointF {
    x: number; // 列方向
    y: number; // 行方向
}
