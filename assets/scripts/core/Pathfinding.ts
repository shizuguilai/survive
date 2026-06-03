// ============================================================
// 网格 A* 寻路（8 方向，不切墙角）
// 通过 isWalkable 回调解耦地图/建筑阻挡
// ============================================================
import { Tile } from "./Types";

type WalkFn = (col: number, row: number) => boolean;

class MinHeap {
    private items: number[] = []; // 节点 index
    private prio: number[] = []; // 对应 f 值

    get size(): number {
        return this.items.length;
    }

    push(item: number, priority: number): void {
        this.items.push(item);
        this.prio.push(priority);
        this.bubbleUp(this.items.length - 1);
    }

    pop(): number {
        const top = this.items[0];
        const last = this.items.length - 1;
        this.items[0] = this.items[last];
        this.prio[0] = this.prio[last];
        this.items.pop();
        this.prio.pop();
        if (this.items.length > 0) this.bubbleDown(0);
        return top;
    }

    private bubbleUp(i: number): void {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.prio[i] >= this.prio[parent]) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    private bubbleDown(i: number): void {
        const n = this.items.length;
        while (true) {
            const l = 2 * i + 1;
            const r = 2 * i + 2;
            let smallest = i;
            if (l < n && this.prio[l] < this.prio[smallest]) smallest = l;
            if (r < n && this.prio[r] < this.prio[smallest]) smallest = r;
            if (smallest === i) break;
            this.swap(i, smallest);
            i = smallest;
        }
    }

    private swap(a: number, b: number): void {
        const ti = this.items[a];
        this.items[a] = this.items[b];
        this.items[b] = ti;
        const tp = this.prio[a];
        this.prio[a] = this.prio[b];
        this.prio[b] = tp;
    }
}

const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

export class Pathfinder {
    private width: number;
    private height: number;
    private gScore: Float64Array;
    private cameFrom: Int32Array;
    private closed: Uint8Array;
    private visitStamp: Int32Array; // 避免每次重置数组
    private stamp = 1;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        const n = width * height;
        this.gScore = new Float64Array(n);
        this.cameFrom = new Int32Array(n);
        this.closed = new Uint8Array(n);
        this.visitStamp = new Int32Array(n);
    }

    private idx(col: number, row: number): number {
        return row * this.width + col;
    }

    private heuristic(c0: number, r0: number, c1: number, r1: number): number {
        const dc = Math.abs(c0 - c1);
        const dr = Math.abs(r0 - r1);
        // 八方向：对角线距离
        return (dc + dr) + (Math.SQRT2 - 2) * Math.min(dc, dr);
    }

    /**
     * 返回从 start 到 goal 的瓦片路径（含 goal，不含 start）；找不到返回 null。
     * @param maxNodes 节点上限，防止极端情况卡死
     */
    find(start: Tile, goal: Tile, isWalkable: WalkFn, maxNodes = 4000): Tile[] | null {
        const { width, height } = this;
        if (!isWalkable(goal.col, goal.row)) return null;
        if (start.col === goal.col && start.row === goal.row) return [];

        const stamp = this.stamp++;
        const open = new MinHeap();
        const startIdx = this.idx(start.col, start.row);
        this.gScore[startIdx] = 0;
        this.cameFrom[startIdx] = -1;
        this.visitStamp[startIdx] = stamp;
        open.push(startIdx, this.heuristic(start.col, start.row, goal.col, goal.row));

        let expanded = 0;
        while (open.size > 0 && expanded < maxNodes) {
            const current = open.pop();
            if (this.closed[current] === stamp) continue;
            this.closed[current] = stamp;
            expanded++;

            const col = current % width;
            const row = (current / width) | 0;
            if (col === goal.col && row === goal.row) {
                return this.reconstruct(current, start);
            }

            for (let d = 0; d < DIRS.length; d++) {
                const nc = col + DIRS[d][0];
                const nr = row + DIRS[d][1];
                if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
                if (!isWalkable(nc, nr)) continue;
                // 不切墙角
                const diagonal = DIRS[d][0] !== 0 && DIRS[d][1] !== 0;
                if (diagonal) {
                    if (!isWalkable(col + DIRS[d][0], row) || !isWalkable(col, row + DIRS[d][1])) {
                        continue;
                    }
                }
                const nIdx = this.idx(nc, nr);
                if (this.closed[nIdx] === stamp) continue;
                const step = diagonal ? Math.SQRT2 : 1;
                const tentative = this.gScore[current] + step;
                if (this.visitStamp[nIdx] !== stamp || tentative < this.gScore[nIdx]) {
                    this.visitStamp[nIdx] = stamp;
                    this.gScore[nIdx] = tentative;
                    this.cameFrom[nIdx] = current;
                    const f = tentative + this.heuristic(nc, nr, goal.col, goal.row);
                    open.push(nIdx, f);
                }
            }
        }
        return null;
    }

    private reconstruct(endIdx: number, start: Tile): Tile[] {
        const path: Tile[] = [];
        let cur = endIdx;
        const startIdx = this.idx(start.col, start.row);
        while (cur !== -1 && cur !== startIdx) {
            path.push({ col: cur % this.width, row: (cur / this.width) | 0 });
            cur = this.cameFrom[cur];
        }
        path.reverse();
        return path;
    }
}
