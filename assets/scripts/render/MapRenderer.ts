// ============================================================
// 地形渲染：把 100x100 瓦片一次性画到一个 Graphics 上
// 地形基本不变，仅在初始化/读档后绘制一次
// ============================================================
import { Color, Graphics } from "cc";
import { TILE } from "../core/Config";
import { TerrainType } from "../core/Types";
import type { World } from "../core/World";

const TERRAIN_COLOR: Record<TerrainType, Color> = {
    [TerrainType.Grass]: new Color(74, 124, 58),
    [TerrainType.Forest]: new Color(38, 74, 22),
    [TerrainType.Stone]: new Color(136, 140, 141),
    [TerrainType.Water]: new Color(47, 111, 159),
    [TerrainType.Ruin]: new Color(107, 93, 79),
    [TerrainType.Road]: new Color(150, 134, 96),
};

export class MapRenderer {
    private g: Graphics;

    constructor(g: Graphics) {
        this.g = g;
    }

    drawTerrain(world: World): void {
        const g = this.g;
        g.clear();
        const map = world.map;
        for (let row = 0; row < map.height; row++) {
            for (let col = 0; col < map.width; col++) {
                const t = map.get(col, row);
                g.fillColor = TERRAIN_COLOR[t];
                g.rect(col * TILE, row * TILE, TILE, TILE);
                g.fill();
            }
        }
    }
}
