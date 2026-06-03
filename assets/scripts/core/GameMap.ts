// ============================================================
// 100x100 瓦片地图 + 程序化生成
// ============================================================
import { MAP_W, MAP_H } from "./Config";
import { TerrainType, Tile } from "./Types";

export class GameMap {
    readonly width: number;
    readonly height: number;
    /** 行优先存储：index = row * width + col */
    terrain: Uint8Array;

    constructor(width = MAP_W, height = MAP_H) {
        this.width = width;
        this.height = height;
        this.terrain = new Uint8Array(width * height);
    }

    idx(col: number, row: number): number {
        return row * this.width + col;
    }

    inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    get(col: number, row: number): TerrainType {
        return this.terrain[this.idx(col, row)] as TerrainType;
    }

    set(col: number, row: number, t: TerrainType): void {
        this.terrain[this.idx(col, row)] = t;
    }

    /** 地形本身是否可通行（水不可通行；建筑阻挡由 World 另行判断） */
    isTerrainWalkable(col: number, row: number): boolean {
        if (!this.inBounds(col, row)) return false;
        return this.get(col, row) !== TerrainType.Water;
    }

    /** 是否可建设（草地或道路，且地形本身允许） */
    isBuildableTerrain(col: number, row: number): boolean {
        if (!this.inBounds(col, row)) return false;
        const t = this.get(col, row);
        return t === TerrainType.Grass || t === TerrainType.Road;
    }

    /** 程序化生成：以草地为底，随机散布森林/石头/水/废墟，并铺设几条道路 */
    generate(seed = Date.now()): void {
        const rng = makeRng(seed);
        const { width, height } = this;

        // 全部草地
        this.terrain.fill(TerrainType.Grass);

        // 森林簇
        this.scatterBlobs(rng, TerrainType.Forest, 18, 6, 60);
        // 石头簇
        this.scatterBlobs(rng, TerrainType.Stone, 10, 4, 30);
        // 水域（湖泊）
        this.scatterBlobs(rng, TerrainType.Water, 6, 5, 40);
        // 废墟（小块）
        this.scatterBlobs(rng, TerrainType.Ruin, 12, 1, 4);

        // 中心十字道路，方便初期建造区
        const cx = Math.floor(width / 2);
        const cy = Math.floor(height / 2);
        for (let c = cx - 15; c <= cx + 15; c++) {
            if (this.inBounds(c, cy)) this.set(c, cy, TerrainType.Road);
        }
        for (let r = cy - 15; r <= cy + 15; r++) {
            if (this.inBounds(cx, r)) this.set(cx, r, TerrainType.Road);
        }

        // 保证出生点(中心)周围是草地/道路，便于建造
        for (let dr = -3; dr <= 3; dr++) {
            for (let dc = -3; dc <= 3; dc++) {
                const c = cx + dc;
                const r = cy + dr;
                if (this.inBounds(c, r) && this.get(c, r) !== TerrainType.Road) {
                    this.set(c, r, TerrainType.Grass);
                }
            }
        }
    }

    /** 随机生成若干“团块”地形 */
    private scatterBlobs(
        rng: () => number,
        type: TerrainType,
        count: number,
        minSize: number,
        maxSize: number
    ): void {
        for (let i = 0; i < count; i++) {
            const ccol = Math.floor(rng() * this.width);
            const crow = Math.floor(rng() * this.height);
            const size = minSize + Math.floor(rng() * (maxSize - minSize + 1));
            // 随机游走铺设团块
            let col = ccol;
            let row = crow;
            for (let s = 0; s < size; s++) {
                if (this.inBounds(col, row)) this.set(col, row, type);
                const dir = Math.floor(rng() * 4);
                if (dir === 0) col++;
                else if (dir === 1) col--;
                else if (dir === 2) row++;
                else row--;
                col = clamp(col, 0, this.width - 1);
                row = clamp(row, 0, this.height - 1);
            }
        }
    }

    /** 查找离 (col,row) 最近的指定地形瓦片（BFS 限定半径） */
    findNearestTerrain(col: number, row: number, type: TerrainType, maxRadius = 40): Tile | null {
        for (let radius = 0; radius <= maxRadius; radius++) {
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
                    const c = col + dc;
                    const r = row + dr;
                    if (this.inBounds(c, r) && this.get(c, r) === type) {
                        return { col: c, row: r };
                    }
                }
            }
        }
        return null;
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** 简单可复现随机数（mulberry32） */
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
