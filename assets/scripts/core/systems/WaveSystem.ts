// ============================================================
// WaveSystem：按天数日程从地图边缘生成尸潮
// 第 1 天为筹备期（不刷），第 2 天起按 Config.zombiesForDay 生成
// ============================================================
import { zombiesForDay } from "../Config";
import { TerrainType } from "../Types";
import type { World } from "../World";

export class WaveSystem {
    static update(world: World, _dt: number): void {
        if (world.day < 2) return;
        if (world.day <= world.waveDaySpawned) return;

        const count = zombiesForDay(world.day);
        spawnWave(world, count);
        world.waveDaySpawned = world.day;
        if (world.onLog) world.onLog(`第 ${world.day} 天：尸潮来袭！${count} 只僵尸`);
    }
}

function spawnWave(world: World, count: number): void {
    const w = world.map.width;
    const h = world.map.height;
    for (let i = 0; i < count; i++) {
        let col = 0;
        let row = 0;
        const side = Math.floor(Math.random() * 4);
        if (side === 0) {
            col = 0;
            row = Math.floor(Math.random() * h);
        } else if (side === 1) {
            col = w - 1;
            row = Math.floor(Math.random() * h);
        } else if (side === 2) {
            col = Math.floor(Math.random() * w);
            row = 0;
        } else {
            col = Math.floor(Math.random() * w);
            row = h - 1;
        }
        // 落在水面则就近找草地
        if (!world.isWalkable(col, row)) {
            const near = world.map.findNearestTerrain(col, row, TerrainType.Grass, 8);
            if (near) {
                col = near.col;
                row = near.row;
            }
        }
        world.spawnZombie(col, row);
    }
}
