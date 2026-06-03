// ============================================================
// 资源仓储：四种资源 + 上限（受仓库数量影响）
// 人口(Population)单独由 World 统计幸存者数量，不在此处
// ============================================================
import { BASE_RESOURCE_CAP, WAREHOUSE_CAP_BONUS } from "./Config";
import { ResourceType } from "./Types";

export class ResourceStore {
    amounts: Record<ResourceType, number> = {
        [ResourceType.Wood]: 0,
        [ResourceType.Stone]: 0,
        [ResourceType.Food]: 0,
        [ResourceType.Metal]: 0,
    };

    private warehouseCount = 0;

    get cap(): number {
        return BASE_RESOURCE_CAP + this.warehouseCount * WAREHOUSE_CAP_BONUS;
    }

    setWarehouseCount(n: number): void {
        this.warehouseCount = n;
    }

    get(type: ResourceType): number {
        return this.amounts[type];
    }

    /** 增加资源（受上限约束），返回实际加入量 */
    add(type: ResourceType, amount: number): number {
        const cap = this.cap;
        const before = this.amounts[type];
        const after = Math.min(cap, before + amount);
        this.amounts[type] = after;
        return after - before;
    }

    canAfford(cost: Partial<Record<ResourceType, number>>): boolean {
        for (const k in cost) {
            const type = Number(k) as ResourceType;
            if (this.amounts[type] < (cost[type] || 0)) return false;
        }
        return true;
    }

    /** 扣除资源（需先确认 canAfford） */
    spend(cost: Partial<Record<ResourceType, number>>): boolean {
        if (!this.canAfford(cost)) return false;
        for (const k in cost) {
            const type = Number(k) as ResourceType;
            this.amounts[type] -= cost[type] || 0;
        }
        return true;
    }
}
