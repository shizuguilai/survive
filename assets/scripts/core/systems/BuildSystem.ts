// ============================================================
// BuildSystem：建造工地进度 + 农场产粮
// （塔楼攻击在 CombatSystem）
// ============================================================
import { BUILDINGS, FARM_FOOD_PER_SEC } from "../Config";
import { BuildingType, EntityState, JobType, ResourceType } from "../Types";
import { entityTile } from "./MovementSystem";
import type { World } from "../World";

export class BuildSystem {
    static update(world: World, dt: number): void {
        // 统计每个建筑上的工人 / 农民数量
        const workerAt: Record<number, number> = {};
        const farmerAt: Record<number, number> = {};

        for (const s of world.survivors) {
            const t = entityTile(s);
            if (!world.map.inBounds(t.col, t.row)) continue;
            const bId = world.buildingGrid[world.map.idx(t.col, t.row)];
            if (bId < 0) continue;
            if (s.job === JobType.Worker && s.state === EntityState.Building) {
                workerAt[bId] = (workerAt[bId] || 0) + 1;
            } else if (s.job === JobType.Farmer && s.state === EntityState.Working) {
                farmerAt[bId] = (farmerAt[bId] || 0) + 1;
            }
        }

        for (const b of world.buildings) {
            if (!b.built) {
                const workers = workerAt[b.id] || 0;
                if (workers > 0) {
                    b.buildProgress += dt * workers;
                    const buildTime = BUILDINGS[b.type].buildTime;
                    if (b.buildProgress >= buildTime) {
                        b.buildProgress = buildTime;
                        b.built = true;
                        world.onBuildingBuilt(b);
                        if (world.onLog) world.onLog(`${BUILDINGS[b.type].name} 建造完成`);
                    }
                }
            } else if (b.type === BuildingType.Farm) {
                const farmers = farmerAt[b.id] || 0;
                if (farmers > 0) {
                    world.addResource(ResourceType.Food, FARM_FOOD_PER_SEC * dt * farmers);
                }
            }
        }
    }
}
