// ============================================================
// CombatSystem：士兵/狙击手攻击、瞭望塔攻击、僵尸寻敌与攻击
// 伤害公式：Damage = Attack - Defense（最低 1）
// ============================================================
import { ATTACK_COOLDOWN, BUILDINGS, SURVIVOR_DEFAULT, ZOMBIE_STATS } from "../Config";
import { Survivor, Zombie } from "../Entities";
import { BuildingType, EntityState, JobType } from "../Types";
import { entityTile, moveAlongPath } from "./MovementSystem";
import type { World } from "../World";

const SOLDIER_RANGE = 1.4;
const SOLDIER_DAMAGE = SURVIVOR_DEFAULT.attack;
const SNIPER_RANGE = 6;
const SNIPER_DAMAGE = 14;

export class CombatSystem {
    static update(world: World, dt: number): void {
        updateSoldiers(world, dt);
        updateTowers(world, dt);
        updateZombies(world, dt);
    }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
}

function nearestZombie(world: World, x: number, y: number, maxRange = Infinity): Zombie | null {
    let best: Zombie | null = null;
    let bestD = maxRange;
    for (const z of world.zombies) {
        if (z.health <= 0) continue;
        const d = dist(x, y, z.x, z.y);
        if (d < bestD) {
            bestD = d;
            best = z;
        }
    }
    return best;
}

function nearestSurvivor(world: World, x: number, y: number): Survivor | null {
    let best: Survivor | null = null;
    let bestD = Infinity;
    for (const s of world.survivors) {
        if (s.health <= 0) continue;
        const d = dist(x, y, s.x, s.y);
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    }
    return best;
}

function stepToward(world: World, ent: { x: number; y: number }, tx: number, ty: number, speed: number, dt: number): void {
    const dx = tx - ent.x;
    const dy = ty - ent.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-4) return;
    const step = Math.min(speed * dt, d);
    const nx = ent.x + (dx / d) * step;
    const ny = ent.y + (dy / d) * step;
    if (world.isWalkable(Math.floor(nx), Math.floor(ny))) {
        ent.x = nx;
        ent.y = ny;
    }
}

// ---------------- 士兵 / 狙击手 ----------------
function updateSoldiers(world: World, dt: number): void {
    for (const s of world.survivors) {
        if (s.health <= 0) continue;
        if (s.job !== JobType.Soldier && s.job !== JobType.Sniper) continue;
        const isSniper = s.job === JobType.Sniper;
        const range = isSniper ? SNIPER_RANGE : SOLDIER_RANGE;
        const dmg = isSniper ? SNIPER_DAMAGE : SOLDIER_DAMAGE;

        s.attackCooldown -= dt;
        const z = nearestZombie(world, s.x, s.y);
        if (!z) {
            s.state = EntityState.Idle;
            continue;
        }
        const d = dist(s.x, s.y, z.x, z.y);
        if (d <= range) {
            s.state = EntityState.Fighting;
            if (s.attackCooldown <= 0) {
                z.health -= Math.max(1, dmg - ZOMBIE_STATS.defense);
                s.attackCooldown = ATTACK_COOLDOWN;
            }
        } else {
            s.state = EntityState.Moving;
            stepToward(world, s, z.x, z.y, SURVIVOR_DEFAULT.moveSpeed, dt);
        }
    }
}

// ---------------- 瞭望塔 ----------------
function updateTowers(world: World, dt: number): void {
    for (const b of world.buildings) {
        if (!b.built || b.type !== BuildingType.WatchTower) continue;
        const def = BUILDINGS[BuildingType.WatchTower];
        b.timer += dt;
        if (b.timer < ATTACK_COOLDOWN) continue;
        const cx = b.col + 0.5;
        const cy = b.row + 0.5;
        const z = nearestZombie(world, cx, cy, def.attackRange);
        if (z) {
            z.health -= Math.max(1, (def.attackDamage || 0) - ZOMBIE_STATS.defense);
            b.timer = 0;
        }
    }
}

// ---------------- 僵尸 ----------------
function updateZombies(world: World, dt: number): void {
    for (const z of world.zombies) {
        if (z.health <= 0) continue;
        z.attackCooldown -= dt;
        z.repathTimer -= dt;

        const zt = entityTile(z);
        const targetBuilding = world.findNearestBuilding(zt.col, zt.row, () => true);

        if (targetBuilding) {
            const cx = targetBuilding.col + 0.5;
            const cy = targetBuilding.row + 0.5;
            const d = dist(z.x, z.y, cx, cy);
            if (d < 1.6) {
                z.state = EntityState.Fighting;
                if (z.attackCooldown <= 0) {
                    targetBuilding.hp -= Math.max(1, ZOMBIE_STATS.attack);
                    z.attackCooldown = ATTACK_COOLDOWN;
                }
                continue;
            }
            // 朝建筑移动：优先寻路，路被墙堵则直冲（撞墙攻击）
            if (z.targetId !== targetBuilding.id || z.repathTimer <= 0 || z.path.length === 0) {
                const p = world.findPath(zt, { col: targetBuilding.col, row: targetBuilding.row });
                z.targetId = targetBuilding.id;
                z.path = p || [];
                z.pathIndex = 0;
                z.repathTimer = 1.5;
            }
            z.state = EntityState.Moving;
            if (z.path.length > 0 && z.pathIndex < z.path.length) {
                moveAlongPath(world.map, z, ZOMBIE_STATS.speed, dt);
            } else {
                stepToward(world, z, cx, cy, ZOMBIE_STATS.speed, dt);
            }
        } else {
            // 没有建筑了 -> 攻击幸存者
            const sv = nearestSurvivor(world, z.x, z.y);
            if (!sv) {
                z.state = EntityState.Idle;
                continue;
            }
            const d = dist(z.x, z.y, sv.x, sv.y);
            if (d < 1.4) {
                z.state = EntityState.Fighting;
                if (z.attackCooldown <= 0) {
                    sv.health -= Math.max(1, ZOMBIE_STATS.attack - SURVIVOR_DEFAULT.defense);
                    z.attackCooldown = ATTACK_COOLDOWN;
                }
            } else {
                z.state = EntityState.Moving;
                stepToward(world, z, sv.x, sv.y, ZOMBIE_STATS.speed, dt);
            }
        }
    }
}
