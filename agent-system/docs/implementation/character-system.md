# 原生角色造型与居民自主穿戴

版本：2026-09-24。依据用户最新纠正：角色初始化即穿衣；穿、脱、持拿和收纳由该居民的模型决定，不提供玩家换装控制。

## 数据与边界

- `packages/sim-core/src/character.ts`：`CharacterAppearance`、`CharacterState`、`CharacterLoadout`、装备目录、所有权/容量校验、私有物品引用及纯动作应用函数。
- `apps/laya-client/src/character-mesh.ts`：`CharacterMesh` 原生 Laya Sprite3D/MeshSprite3D；圆头、单个圆润或修长身体、两个圆手；五种发型、四种胡须及衣帽、短刀、双手矛、两种背包。
- 外观参数为初始化配置。`generateCharacterAppearance(seed)` 不使用 `Math.random`，不访问模拟 RNG。创建时可在 `createCharacterState` 返回的初始状态上配置尺寸与颜色，再通过 `validateCharacterState` 验证；运行中没有玩家外观编辑命令。
- 初始物品每名居民各自创建一套，共七件：亚麻上衣、旅行外套、宽檐帽、短刀、双手长矛、小背包、远行背包。初始已穿亚麻上衣和小背包。物品是真实有限的状态实例，不是每次换衣时复制模板。
- `loadout` 存内部物品实例 ID；模型只能获得 `listOwnEquipment(character, residentId)` 返回的主人局部 `item_1` 等引用。私有引用固化在物品实例 `itemRef` 字段，不随数组位置变化。禁止通过全局物品 ID 操作、禁止替他人操作、禁止凭空创造物品。未来若添加拾取/交易，需要持久化不复用的引用分配器；当前不实现交易或掉落。

## 动作接入

```ts
type EquipmentAction =
  | { type: 'equip_item'; itemRef: string; slot?: EquipmentSlot }
  | { type: 'unequip_item'; itemRef: string };

// 动作执行器只在正模拟时长完成后调用；认知批次提交时只安装动作计划。
const result = applyEquipmentAction(resident, action);
if (result.ok) resident.character = result.resident.character;
// 失败结果必须变成该居民私人执行反馈；不修改旧角色，不丢物。
```

`applyEquipmentAction` 是纯函数，不推进时间、不创建网络调用、不自行提交世界。调用方负责动作时长、全局思考屏障、动作中断、世界 revision 和回放事件。全世界思考暂停时，穿衣进度也暂停。这里不声明执行器集成或真实模型换装已通过。

装备部位：`torso / head / leftHand / rightHand / back`。双手武器必须同时占据左右手；用单手装备替换任一只手时，旧双手武器整件收纳。卸下双手武器一次同时释放双手。同一单手物品换手后原手释放，不能复制。

库存包含所有本人持有物品；已装备物品不占收纳格，未装备物品按目录 `inventoryUnits` 计入。容量等于基础容量加当前背包扩容。更换/卸下背包后，在同一候选状态计算容量；不足则拒绝整个动作，保留旧背包与全部物品。卸下衣服不删除衣物；渲染保留基础内衣。

## 感官与渲染

`publicCharacterSummary(character)` 以简短自然中文概括可观察的肤色、发型、胡须、身形以及已穿戴/持拿物品。颜色使用近似名称，不在界面或感官中展示十六进制值；实际颜色存储与渲染不变。摘要不提供背包内容、容量、内部物品 ID 或私人引用。调用方仍必须先通过视野与遮挡过滤；本函数不是全世界广播。

`listOwnEquipment` 只用于该居民本人的模型输入。传入其他 owner 时返回空列表。不能把所有居民的列表拼进一个共享模型上下文。

原生渲染 API：

```ts
const mesh = createCharacterMesh(resident);
scene.addChild(mesh.node);
updateCharacterMesh(mesh, resident); // 位置/朝向每帧同步
// mesh.height 可用于名字标签高度
disposeCharacterMesh(mesh);
```

外观/可见装备指纹变化才重建几何体；单纯位置和朝向变化不会重建。重建和销毁释放模块持有的材质、几何资源。网格不独立启动动画计时器，也不消耗模拟随机数。武器目前只有持拿造型与槽位/容量规则，未实现伤害、瞄准、攻击或战斗数值。

## 验证与状态

| 状态 | 本模块证据 |
|---|---|
| 代码 | 数据和原生网格模块已完成，等待主工程接线 |
| 静态检查 | 对 character.ts、character-mesh.ts 和测试执行严格 TypeScript 检查通过 |
| Mock/单元 | `node --test tests/character.test.ts` 15 项通过；含私有引用、装备守恒、容量原子拒绝、双手槽位、外观信息隔离、网格资源生命周期 |
| 真实模型 | 本模块未运行，不得由单元测试推导完成 |
| Web/Laya 构建 | 由集成任务单独记录；本模块未执行 IDE 构建 |
| 浏览器 | 未在此模块任务中实测；网格生命周期测试使用 API 替身，不是真实渲染验收 |
| 真机 | 未运行 |
| 发布/推送 | 未执行 |

静态检查命令：

```sh
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --strict --skipLibCheck packages/sim-core/src/character.ts apps/laya-client/src/character-mesh.ts tests/character.test.ts
```
