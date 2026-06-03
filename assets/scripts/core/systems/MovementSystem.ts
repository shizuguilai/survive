// ============================================================
// 移动：沿路径(瓦片列表)平滑移动实体
// 被 JobSystem / CombatSystem / 僵尸逻辑复用
// ============================================================
import { ROAD_SPEED_MULT } from "../Config";
import { TerrainType, Tile } from "../Types";
import type { GameMap } from "../GameMap";

export interface Movable {
    x: number;
    y: number;
    path: Tile[];
    pathIndex: number;
}

/** 瓦片中心点坐标 */
function tileCenter(t: Tile): { cx: number; cy: number } {
    return { cx: t.col + 0.5, cy: t.row + 0.5 };
}

/**
 * 沿路径移动；到达路径末端返回 true。
 * @param baseSpeed 瓦片/秒
 */
export function moveAlongPath(map: GameMap, ent: Movable, baseSpeed: number, dt: number): boolean {
    if (ent.pathIndex >= ent.path.length) return true;

    // 道路加速
    const col = Math.floor(ent.x);
    const row = Math.floor(ent.y);
    let speed = baseSpeed;
    if (map.inBounds(col, row) && map.get(col, row) === TerrainType.Road) {
        speed *= ROAD_SPEED_MULT;
    }

    let remaining = speed * dt;
    while (remaining > 0 && ent.pathIndex < ent.path.length) {
        const target = tileCenter(ent.path[ent.pathIndex]);
        const dx = target.cx - ent.x;
        const dy = target.cy - ent.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= remaining) {
            ent.x = target.cx;
            ent.y = target.cy;
            ent.pathIndex++;
            remaining -= dist;
        } else {
            ent.x += (dx / dist) * remaining;
            ent.y += (dy / dist) * remaining;
            remaining = 0;
        }
    }
    return ent.pathIndex >= ent.path.length;
}

/** 设置实体的新路径 */
export function setPath(ent: Movable, path: Tile[]): void {
    ent.path = path;
    ent.pathIndex = 0;
}

/** 实体当前所在瓦片 */
export function entityTile(ent: { x: number; y: number }): Tile {
    return { col: Math.floor(ent.x), row: Math.floor(ent.y) };
}
