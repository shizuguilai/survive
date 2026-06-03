// ============================================================
// 建筑实例模型（定义在 Config.BUILDINGS）
// ============================================================
import { BUILDINGS } from "./Config";
import { BuildingType } from "./Types";

export interface Building {
    id: number;
    type: BuildingType;
    col: number;
    row: number;
    hp: number;
    maxHp: number;
    /** 是否已建成；false 表示还是建造工地 */
    built: boolean;
    /** 建造进度累计时间（秒），达到 buildTime 即建成 */
    buildProgress: number;
    /** 通用计时器（农场产粮、塔楼攻击冷却） */
    timer: number;
}

export function createBuilding(id: number, type: BuildingType, col: number, row: number): Building {
    const def = BUILDINGS[type];
    return {
        id,
        type,
        col,
        row,
        hp: def.hp,
        maxHp: def.hp,
        built: false,
        buildProgress: 0,
        timer: 0,
    };
}
