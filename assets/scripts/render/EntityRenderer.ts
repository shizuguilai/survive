// ============================================================
// 实体渲染：每帧重绘建筑 + 幸存者 + 僵尸
// 用单个 Graphics 立即模式绘制（实体量极大时可改为节点池优化）
// ============================================================
import { Color, Graphics } from "cc";
import { TILE } from "../core/Config";
import { BuildingType, JobType } from "../core/Types";
import type { World } from "../core/World";

const BUILDING_COLOR: Record<BuildingType, Color> = {
    [BuildingType.Tent]: new Color(170, 140, 90),
    [BuildingType.House]: new Color(200, 160, 100),
    [BuildingType.Farm]: new Color(120, 180, 70),
    [BuildingType.Warehouse]: new Color(150, 130, 180),
    [BuildingType.Wall]: new Color(110, 110, 115),
    [BuildingType.WatchTower]: new Color(220, 120, 60),
    [BuildingType.Barracks]: new Color(180, 70, 70),
};

const C_SURVIVOR = new Color(70, 170, 255);
const C_SOLDIER = new Color(241, 196, 15);
const C_ZOMBIE = new Color(210, 60, 60);
const C_SITE = new Color(60, 60, 70);
const C_SITE_LINE = new Color(230, 230, 120);

export class EntityRenderer {
    private g: Graphics;

    constructor(g: Graphics) {
        this.g = g;
    }

    sync(world: World): void {
        const g = this.g;
        g.clear();

        // 建筑
        for (const b of world.buildings) {
            const x = b.col * TILE;
            const y = b.row * TILE;
            if (b.built) {
                g.fillColor = BUILDING_COLOR[b.type];
                g.rect(x + 2, y + 2, TILE - 4, TILE - 4);
                g.fill();
            } else {
                // 建造工地：灰底 + 黄色虚框 + 进度
                g.fillColor = C_SITE;
                g.rect(x + 2, y + 2, TILE - 4, TILE - 4);
                g.fill();
                g.lineWidth = 2;
                g.strokeColor = C_SITE_LINE;
                g.rect(x + 2, y + 2, TILE - 4, TILE - 4);
                g.stroke();
            }
        }

        // 幸存者
        for (const s of world.survivors) {
            const cx = s.x * TILE;
            const cy = s.y * TILE;
            g.fillColor = s.job === JobType.Soldier || s.job === JobType.Sniper ? C_SOLDIER : C_SURVIVOR;
            g.circle(cx, cy, TILE * 0.3);
            g.fill();
        }

        // 僵尸
        for (const z of world.zombies) {
            const cx = z.x * TILE;
            const cy = z.y * TILE;
            g.fillColor = C_ZOMBIE;
            g.circle(cx, cy, TILE * 0.28);
            g.fill();
        }
    }
}
