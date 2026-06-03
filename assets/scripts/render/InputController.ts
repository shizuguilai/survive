// ============================================================
// 输入：单指拖动平移、双指缩放、点击放置建筑/操作 HUD
// 通过全局 input 监听，HUD 命中优先于世界
// ============================================================
import { EventTouch, Input, input, Touch } from "cc";
import { BuildingType } from "../core/Types";
import type { GameRoot } from "./GameRoot";

const SCALE_MIN = 0.25;
const SCALE_MAX = 2.0;
const TAP_THRESHOLD = 10; // 像素

export class InputController {
    private game: GameRoot;
    selectedBuilding: BuildingType | null = null;

    private downX = 0;
    private downY = 0;
    private lastX = 0;
    private lastY = 0;
    private moved = false;
    private pinching = false;
    private pinchStartDist = 0;
    private pinchStartScale = 1;

    constructor(game: GameRoot) {
        this.game = game;
    }

    enable(): void {
        input.on(Input.EventType.TOUCH_START, this.onStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onMove, this);
        input.on(Input.EventType.TOUCH_END, this.onEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onEnd, this);
    }

    disable(): void {
        input.off(Input.EventType.TOUCH_START, this.onStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onMove, this);
        input.off(Input.EventType.TOUCH_END, this.onEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onEnd, this);
    }

    private onStart(e: EventTouch): void {
        const touches = e.getTouches();
        if (touches.length >= 2) {
            this.beginPinch(touches);
            this.moved = true;
            return;
        }
        const p = e.getUILocation();
        this.downX = this.lastX = p.x;
        this.downY = this.lastY = p.y;
        this.moved = false;
        this.pinching = false;
    }

    private onMove(e: EventTouch): void {
        const touches = e.getTouches();
        if (touches.length >= 2) {
            this.doPinch(touches);
            this.moved = true;
            return;
        }
        const p = e.getUILocation();
        const dx = p.x - this.lastX;
        const dy = p.y - this.lastY;
        if (Math.abs(p.x - this.downX) + Math.abs(p.y - this.downY) > TAP_THRESHOLD) {
            this.moved = true;
        }
        const c = this.game.worldContainer;
        const pos = c.position;
        c.setPosition(pos.x + dx, pos.y + dy, pos.z);
        this.lastX = p.x;
        this.lastY = p.y;
    }

    private onEnd(e: EventTouch): void {
        if (this.pinching) {
            if (e.getTouches().length < 2) this.pinching = false;
            return;
        }
        if (this.moved) return;
        const p = e.getUILocation();
        this.handleTap(p.x, p.y);
    }

    private beginPinch(touches: Touch[]): void {
        const a = touches[0].getUILocation();
        const b = touches[1].getUILocation();
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinchStartScale = this.game.worldContainer.scale.x;
        this.pinching = true;
    }

    private doPinch(touches: Touch[]): void {
        if (!this.pinching) {
            this.beginPinch(touches);
            return;
        }
        const a = touches[0].getUILocation();
        const b = touches[1].getUILocation();
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        let s = this.pinchStartScale * (d / this.pinchStartDist);
        s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));
        this.game.worldContainer.setScale(s, s, 1);
    }

    private handleTap(uiX: number, uiY: number): void {
        const action = this.game.hud.hitTest(uiX, uiY);
        if (action) {
            this.handleAction(action);
            return;
        }
        const tile = this.game.screenToTile(uiX, uiY);
        if (!tile) return;
        if (this.selectedBuilding !== null) {
            const ok = this.game.world.placeBuilding(this.selectedBuilding, tile.col, tile.row);
            if (!ok && this.game.world.onLog) this.game.world.onLog("无法在此建造");
        }
    }

    private handleAction(action: string): void {
        if (action === "cancel") {
            this.selectedBuilding = null;
            return;
        }
        if (action.startsWith("build:")) {
            const t = Number(action.split(":")[1]) as BuildingType;
            this.selectedBuilding = this.selectedBuilding === t ? null : t;
        } else if (action.startsWith("speed:")) {
            this.game.world.gameSpeed = Number(action.split(":")[1]);
        }
    }
}
