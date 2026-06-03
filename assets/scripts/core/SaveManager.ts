// ============================================================
// 存档：World 快照 <-> JSON，存储介质由外部注入
// （Web 与抖音都用 sys.localStorage）
// ============================================================
import { ResourceType } from "./Types";
import type { World } from "./World";

export interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const SAVE_KEY = "project_outpost_save_v1";

export class SaveManager {
    static save(world: World, storage: KVStorage): void {
        const data = {
            terrain: Array.from(world.map.terrain),
            resources: world.resources.amounts,
            survivors: world.survivors,
            zombies: world.zombies,
            buildings: world.buildings,
            day: world.day,
            dayTime: world.dayTime,
            totalTime: world.totalTime,
            waveDaySpawned: world.waveDaySpawned,
            reproTimer: world.reproTimer,
            nextId: (world as any)._nextId,
        };
        try {
            storage.setItem(SAVE_KEY, JSON.stringify(data));
        } catch (e) {
            // 存储失败（容量/权限）忽略
        }
    }

    static hasSave(storage: KVStorage): boolean {
        return !!storage.getItem(SAVE_KEY);
    }

    static clear(storage: KVStorage): void {
        storage.removeItem(SAVE_KEY);
    }

    /** 读档并写入 world，成功返回 true */
    static load(world: World, storage: KVStorage): boolean {
        const raw = storage.getItem(SAVE_KEY);
        if (!raw) return false;
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return false;
        }

        // 地图
        if (data.terrain && data.terrain.length === world.map.terrain.length) {
            world.map.terrain.set(data.terrain);
        }
        // 资源
        if (data.resources) {
            world.resources.amounts[ResourceType.Wood] = data.resources[ResourceType.Wood] || 0;
            world.resources.amounts[ResourceType.Stone] = data.resources[ResourceType.Stone] || 0;
            world.resources.amounts[ResourceType.Food] = data.resources[ResourceType.Food] || 0;
            world.resources.amounts[ResourceType.Metal] = data.resources[ResourceType.Metal] || 0;
        }
        // 实体与建筑
        world.survivors = data.survivors || [];
        world.zombies = data.zombies || [];
        world.buildings = data.buildings || [];
        world.day = data.day || 1;
        world.dayTime = data.dayTime || 0;
        world.totalTime = data.totalTime || 0;
        world.waveDaySpawned = data.waveDaySpawned || 0;
        world.reproTimer = data.reproTimer || 0;
        (world as any)._nextId = data.nextId || 1;

        // 重建占用 / 阻挡网格
        world.buildingGrid.fill(-1);
        world.blockGrid.fill(0);
        for (const b of world.buildings) {
            world.buildingGrid[world.map.idx(b.col, b.row)] = b.id;
        }
        world.recomputeStats();
        // 重新标记墙体阻挡
        for (const b of world.buildings) {
            if (b.built) world.onBuildingBuilt(b);
        }
        return true;
    }
}
