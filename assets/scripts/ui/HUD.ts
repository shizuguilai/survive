// ============================================================
// HUD：顶部资源栏 / 左侧建筑菜单 / 底部时间栏 / 变速 / 日志
// 全部用代码创建 UI 节点；按钮命中检测交给 InputController
// ============================================================
import { Color, Graphics, Label, Node, UITransform, view } from "cc";
import { BUILDINGS } from "../core/Config";
import { BuildingType, ResourceType } from "../core/Types";
import type { World } from "../core/World";

export interface HudButton {
    action: string; // 'build:0' | 'speed:2' | 'cancel'
    cx: number;
    cy: number;
    w: number;
    h: number;
}

const RES_NAME: Record<ResourceType, string> = {
    [ResourceType.Wood]: "木",
    [ResourceType.Stone]: "石",
    [ResourceType.Food]: "粮",
    [ResourceType.Metal]: "金",
};

const BUILD_ORDER: BuildingType[] = [
    BuildingType.Tent,
    BuildingType.House,
    BuildingType.Farm,
    BuildingType.Warehouse,
    BuildingType.Wall,
    BuildingType.WatchTower,
    BuildingType.Barracks,
];

const SPEEDS = [0, 1, 2, 3];

export class HUD {
    private world: World;
    W: number;
    H: number;
    buttons: HudButton[] = [];

    private bg: Graphics;
    private resourceLabel: Label;
    private statusLabel: Label;
    private logLabel: Label;
    private logText = "";

    constructor(parent: Node, world: World) {
        this.world = world;
        const size = view.getVisibleSize();
        this.W = size.width;
        this.H = size.height;

        // 背景 Graphics（先加，保证在标签下层）
        const bgNode = new Node("HudBg");
        bgNode.layer = parent.layer;
        bgNode.addComponent(UITransform);
        this.bg = bgNode.addComponent(Graphics);
        parent.addChild(bgNode);

        this.layoutButtons();

        // 顶部资源栏
        this.resourceLabel = this.makeLabel(parent, "", -this.W / 2 + 12, this.H / 2 - 20, 18, 0);
        // 底部状态栏
        this.statusLabel = this.makeLabel(parent, "", -this.W / 2 + 12, -this.H / 2 + 20, 16, 0);
        // 日志（顶部居中偏下）
        this.logLabel = this.makeLabel(parent, "", 0, this.H / 2 - 52, 15, 0.5);
        this.logLabel.color = new Color(255, 220, 120);

        // 建筑按钮文字
        for (const b of this.buttons) {
            if (b.action.startsWith("build:")) {
                const type = Number(b.action.split(":")[1]) as BuildingType;
                const def = BUILDINGS[type];
                this.makeLabel(parent, `${def.name}\n${this.costStr(type)}`, b.cx, b.cy, 14, 0.5);
            } else if (b.action.startsWith("speed:")) {
                const v = Number(b.action.split(":")[1]);
                const txt = v === 0 ? "II" : `${v}x`;
                this.makeLabel(parent, txt, b.cx, b.cy, 16, 0.5);
            }
        }

        // 接管日志
        world.onLog = (m: string) => {
            this.logText = m;
        };
    }

    private layoutButtons(): void {
        // 左侧建筑按钮
        const bw = 96;
        const bh = 46;
        const gap = 8;
        const startY = this.H / 2 - 120;
        const x = -this.W / 2 + bw / 2 + 8;
        BUILD_ORDER.forEach((type, i) => {
            this.buttons.push({
                action: `build:${type}`,
                cx: x,
                cy: startY - i * (bh + gap),
                w: bw,
                h: bh,
            });
        });

        // 变速按钮（右下）
        const sw = 44;
        const sh = 38;
        const sgap = 8;
        const sy = -this.H / 2 + sh / 2 + 12;
        SPEEDS.forEach((v, i) => {
            this.buttons.push({
                action: `speed:${v}`,
                cx: this.W / 2 - (SPEEDS.length - i) * (sw + sgap),
                cy: sy,
                w: sw,
                h: sh,
            });
        });
    }

    /** 命中检测：传入 UI 坐标（左下原点），返回 action 或 null */
    hitTest(uiX: number, uiY: number): string | null {
        const cx = uiX - this.W / 2;
        const cy = uiY - this.H / 2;
        for (const b of this.buttons) {
            if (Math.abs(cx - b.cx) <= b.w / 2 && Math.abs(cy - b.cy) <= b.h / 2) {
                return b.action;
            }
        }
        return null;
    }

    refresh(selectedBuilding: BuildingType | null): void {
        // 文本
        const r = this.world.resources;
        const cap = Math.floor(r.cap);
        this.resourceLabel.string =
            `${RES_NAME[ResourceType.Wood]}${Math.floor(r.get(ResourceType.Wood))} ` +
            `${RES_NAME[ResourceType.Stone]}${Math.floor(r.get(ResourceType.Stone))} ` +
            `${RES_NAME[ResourceType.Food]}${Math.floor(r.get(ResourceType.Food))} ` +
            `${RES_NAME[ResourceType.Metal]}${Math.floor(r.get(ResourceType.Metal))}  (上限${cap})`;

        this.statusLabel.string =
            `第${this.world.day}天  人口${this.world.populationCount}/${this.world.housingCapacity}  ` +
            `僵尸${this.world.zombies.length}  下一波${Math.ceil(this.world.timeToNextDay)}s  ` +
            `速度x${this.world.gameSpeed}`;

        this.logLabel.string = this.logText;

        // 重绘背景与按钮
        this.drawBg(selectedBuilding);
    }

    private drawBg(selectedBuilding: BuildingType | null): void {
        const g = this.bg;
        g.clear();

        // 顶/底半透明条
        g.fillColor = new Color(0, 0, 0, 130);
        g.rect(-this.W / 2, this.H / 2 - 36, this.W, 36);
        g.fill();
        g.rect(-this.W / 2, -this.H / 2, this.W, 34);
        g.fill();

        for (const b of this.buttons) {
            let selected = false;
            if (selectedBuilding !== null && b.action === `build:${selectedBuilding}`) selected = true;
            if (b.action === `speed:${this.world.gameSpeed}`) selected = true;

            g.fillColor = selected ? new Color(60, 110, 70, 230) : new Color(30, 38, 52, 220);
            g.roundRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h, 6);
            g.fill();
            if (selected) {
                g.lineWidth = 2;
                g.strokeColor = new Color(120, 230, 140, 255);
                g.roundRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h, 6);
                g.stroke();
            }
        }
    }

    private costStr(type: BuildingType): string {
        const cost = BUILDINGS[type].cost;
        const parts: string[] = [];
        for (const k in cost) {
            const rt = Number(k) as ResourceType;
            parts.push(`${RES_NAME[rt]}${cost[rt]}`);
        }
        return parts.join(" ");
    }

    private makeLabel(parent: Node, text: string, x: number, y: number, size: number, anchorX: number): Label {
        const n = new Node("lbl");
        n.layer = parent.layer;
        const tr = n.addComponent(UITransform);
        tr.setAnchorPoint(anchorX, 0.5);
        const l = n.addComponent(Label);
        l.useSystemFont = true;
        l.fontSize = size;
        l.lineHeight = size + 2;
        l.string = text;
        l.color = new Color(235, 240, 245);
        l.horizontalAlign =
            anchorX === 0 ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
        parent.addChild(n);
        n.setPosition(x, y, 0);
        return l;
    }
}
