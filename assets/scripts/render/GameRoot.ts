// ============================================================
// GameRoot：游戏入口组件
// 挂在场景里一个空节点上即可，其余节点全部代码创建
// ============================================================
import { _decorator, Component, Graphics, Layers, Node, sys, UITransform, Vec3 } from "cc";
import { TICK_DT, TILE } from "../core/Config";
import { Tile } from "../core/Types";
import { World } from "../core/World";
import { SaveManager } from "../core/SaveManager";
import { MapRenderer } from "./MapRenderer";
import { EntityRenderer } from "./EntityRenderer";
import { InputController } from "./InputController";
import { HUD } from "../ui/HUD";

const { ccclass } = _decorator;

const INITIAL_SCALE = 0.5;
const AUTOSAVE_INTERVAL = 15; // 秒

@ccclass("GameRoot")
export class GameRoot extends Component {
    world!: World;
    worldContainer!: Node;
    mapNode!: Node;
    hud!: HUD;

    private mapRenderer!: MapRenderer;
    private entityRenderer!: EntityRenderer;
    private inputCtrl!: InputController;

    private acc = 0;
    private saveTimer = 0;

    onLoad(): void {
        // 1) 初始化世界（有存档则读档覆盖）
        this.world = new World();
        this.world.init();
        if (SaveManager.hasSave(sys.localStorage)) {
            SaveManager.load(this.world, sys.localStorage);
        }

        // 强制 UI_2D 层，确保被 Canvas 相机渲染（否则可能黑屏）
        const layer = Layers.Enum.UI_2D;
        this.node.layer = layer;

        // 2) 世界容器（平移/缩放此节点）
        this.worldContainer = new Node("WorldContainer");
        this.worldContainer.layer = layer;
        this.worldContainer.addComponent(UITransform);
        this.node.addChild(this.worldContainer);
        const c = this.world.center();
        this.worldContainer.setScale(INITIAL_SCALE, INITIAL_SCALE, 1);
        this.worldContainer.setPosition(-c.col * TILE * INITIAL_SCALE, -c.row * TILE * INITIAL_SCALE, 0);

        // 3) 地形层
        this.mapNode = new Node("MapGraphics");
        this.mapNode.layer = layer;
        this.mapNode.addComponent(UITransform);
        const mapG = this.mapNode.addComponent(Graphics);
        this.worldContainer.addChild(this.mapNode);
        this.mapRenderer = new MapRenderer(mapG);
        this.mapRenderer.drawTerrain(this.world);

        // 4) 实体层
        const entNode = new Node("EntityLayer");
        entNode.layer = layer;
        entNode.addComponent(UITransform);
        const entG = entNode.addComponent(Graphics);
        this.worldContainer.addChild(entNode);
        this.entityRenderer = new EntityRenderer(entG);

        // 5) HUD（屏幕固定层）
        const hudNode = new Node("HUDLayer");
        hudNode.layer = layer;
        hudNode.addComponent(UITransform);
        this.node.addChild(hudNode);
        this.hud = new HUD(hudNode, this.world);

        // 6) 输入
        this.inputCtrl = new InputController(this);
        this.inputCtrl.enable();
    }

    onDestroy(): void {
        if (this.inputCtrl) this.inputCtrl.disable();
    }

    update(dt: number): void {
        if (dt > 0.25) dt = 0.25; // 防止卡顿后大跳
        this.acc += dt;
        const speed = this.world.gameSpeed;
        while (this.acc >= TICK_DT) {
            for (let i = 0; i < speed; i++) this.world.tick(TICK_DT);
            this.acc -= TICK_DT;
        }

        this.entityRenderer.sync(this.world);
        this.hud.refresh(this.inputCtrl.selectedBuilding);

        this.saveTimer += dt;
        if (this.saveTimer >= AUTOSAVE_INTERVAL) {
            this.saveTimer = 0;
            SaveManager.save(this.world, sys.localStorage);
        }
    }

    /** UI 坐标(左下原点) -> 瓦片坐标 */
    screenToTile(uiX: number, uiY: number): Tile | null {
        const tr = this.mapNode.getComponent(UITransform)!;
        const local = tr.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
        const col = Math.floor(local.x / TILE);
        const row = Math.floor(local.y / TILE);
        if (!this.world.map.inBounds(col, row)) return null;
        return { col, row };
    }
}
