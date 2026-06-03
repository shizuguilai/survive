// ============================================================
// PopulationSystem：满足条件时定期增长人口
// 条件：Food > Population * 3 且 住房容量充足 且 当前人口 > 2
// 每 120 秒 +1 人口，新生人口默认 Unassigned
// ============================================================
import { REPRO } from "../Config";
import { BuildingType, JobType, ResourceType } from "../Types";
import type { World } from "../World";

export class PopulationSystem {
    static update(world: World, dt: number): void {
        const pop = world.populationCount;
        const food = world.resources.get(ResourceType.Food);

        const conditionsMet =
            food > pop * REPRO.foodFactor &&
            world.housingCapacity > pop &&
            pop >= REPRO.minPopulation;

        if (!conditionsMet) {
            world.reproTimer = 0;
            return;
        }

        world.reproTimer += dt;
        if (world.reproTimer >= REPRO.interval) {
            world.reproTimer = 0;
            // 在一个有住房的建筑附近出生
            const house = world.findNearestBuilding(
                world.center().col,
                world.center().row,
                (b) => b.built && (b.type === BuildingType.House || b.type === BuildingType.Tent)
            );
            const spawn = house ? { col: house.col, row: house.row } : world.center();
            world.spawnSurvivor(spawn.col, spawn.row, JobType.Unassigned);
            if (world.onLog) world.onLog("新的幸存者加入了营地");
        }
    }
}
