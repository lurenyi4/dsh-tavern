# 柏宝书台账功能研究

研究日期：2026-09-09。只读源码，未运行真实 SillyTavern 会话、未调用模型；下文的机制为源码证据，示例与限制推导会注明。研究版本固定为 `5c8a6b60d8c1185e169c46d43f63fce7d35d8583`。只讨论台账，不展开向量检索及多层摘要。

## 玩家看到的效果（界面源码核对）

以下依据 Vue 页面模板和交互处理，未安装到真实 SillyTavern 进行游玩验证，也没有实测提取准确率、耗时或长对话性能。

| 页面 | 展示和交互 | 源码 |
| --- | --- | --- |
| 物品 | 名称、数量、描述、寄存地点；可以添加、编辑、删除。不是所有权分账系统，字段没有独立 owner，同名物品共用名称键。 | [物品列表](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/items/index.vue#L72-L144)、[物品结构](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/types.ts#L22-L40) |
| 角色 | 主要角色置顶，其余按在场、同区域、不在场分组；展示身份、与主角关系、所在地，重要/在场角色还有穿着和状态；能手动设为主要角色或随行同伴。 | [分组计算](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/npcs/index.vue#L156-L195)、[角色卡](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/npcs/index.vue#L435-L621) |
| 场景 | 可折叠地点树，当前地点与祖先路径高亮；地点卡带描述和当地寄存物品。支持修改层级；“前往”只填写聊天草稿，不直接移动人物。 | [场景页面](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/scenes/index.vue#L292-L375) |
| 摘要页附属面板 | “眼下局势”显示当前参与者、局面等；计划、悬念分别折叠计数，展示创建楼层与时间。列表只展示未了结项。 | [筛选](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/summary/index.vue#L46-L80)、[界面](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/pages/summary/index.vue#L795-L939) |
| 楼层小面板 | 展示该楼摘要和分类变动，可就地修改或删除一笔变动，帮助追查账目来源。 | [变动面板](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/components/FloorPanel.vue#L736-L780) |

“关系”以自然语言字段记录，与主角关系和其他人物的长期关系分开。源码中名为“长期关系图”的函数实际生成文本列表，不能据此声称有可视化关系网。[关系格式化函数](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/npcRelations.ts#L11-L43)

### 效果举例（解释性示例，不是实际生成结果）

正文写到：“林岚把两瓶解药交给你，你用掉一瓶，把铜匣留在客栈，随后与她前往旧钟楼。”假设之前物品为空、提取正确，玩家可查阅到：

- 物品：解药 ×1（随身）；铜匣（寄存在客栈）。
- 角色：林岚（随行）；关系沿用已知信息，不因一次赠药自动变成挚友。
- 场景：保留客栈节点；新增或复用旧钟楼，标出当前位置；客栈下仍可看到铜匣。

产品上的意义是把散落在正文里的事实变成“现在可以查的清单”，减少玩家翻聊天记录。这是对需求的判断，不是经过用户实验得出的结论。

### 借鉴范围

这位群友的核心诉求可表述为：**自动整理、随时查阅、通用人物卡、允许纠错，并能跟随剧情回退。** 可先独立评估这条体验，不必同时决定引入其多层摘要、向量检索或上下文裁剪。柏宝书自身已有继续记账但不向主模型发送当前状态的模式，证明查看台账和向模型注入状态在其产品中是可分开的选择。[仅记录提示](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/components/SummaryOnlyNotice.vue#L1-L18)

本轮不确定 DSH 的落地架构、不修改业务代码；也不把通用提取能力理解成对所有人物卡都能准确盘点。

## 台账的数据与更新机制

### 1. 台账和逐楼摘要共用一次模型提取

它没有为物品、地点、NPC 分别启动一套 Agent。正常单楼处理先取目标 AI 回复及其前面未被覆盖的用户消息，再取目标楼之前的台账和历史摘要，读取人物卡、persona 与世界书，向“summary”任务配置的渠道发出一次请求。未指定副 API 时回退当前主 API。输出必须包含 summary，台账变化与其一起放在 JSON 中。

[源码 src/memory/engine.ts:1115–1198](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1115-L1198) [源码 src/memory/engine.ts:952–963](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L952-L963)

输入组成：system 中是插件自己的前置指令、人物卡、persona、世界书；user 是当前状态、历史、待整理正文及结构化提取规则；随后还有 system 检查清单与 assistant 预填。现有物品、最近物品变动、地点树、NPC 名册和未了结计划都给整理模型作参考，不是只靠本轮短文本盲抽。人物卡只读取 description/personality/scenario，群聊暂不合并人物卡，persona 独立读取。

[源码 src/memory/engine.ts:1115–1198](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1115-L1198) [源码 src/memory/engine.ts:303–343](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L303-L343)

输出是变化指令：物品 add/update/remove，地点 add/update/reparent，NPC add/update/remove；另有当前时间地点、主角状态、互动局势、计划等。物品 add 为增量数量，update 为新的总数量，降至零或 remove 删除；NPC 同名 add 补齐档案，update 更新。不是每轮让模型重写全量清单。

[源码 src/memory/prompts.ts:334–425](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/prompts.ts#L334-L425) [源码 src/memory/apply.ts:1129–1265](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1129-L1265)

### 2. 收录标准有意严格，并非“正文出现什么都列出”

物品原则是主动获取、值得保留且有剧情意义，日常环境物件及普通服饰通常排除；地点需有名字、实际到达且有具体描述；NPC 要有具体、有后续意义的互动，或被反复指涉的重要人物。关系更新要求明确约定、明确表述或客观质变，不把一次争执直接判成决裂；暂时离开更新所在地，不删除 NPC。

[源码 src/memory/prompts.ts:87–180](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/prompts.ts#L87-L180)

因此产品效果应理解为“有筛选的游玩档案”。模型依然可能漏记、误判。主要角色的 outfit/location/condition 在长期离场后还允许克制的合理推演，因此也不能宣称所有栏位都是严格的已证实事实。

[源码 src/memory/prompts.ts:180–215](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/prompts.ts#L180-L215)

### 3. 更新频率是下一轮开始时整理上一条稳定回复

正常自动流程：用户发下一条消息，整理上一条已定稿 AI；重新生成/swipe 时跳过正在变的末尾 AI。一次最多处理一楼，优先最早缺口，busy 锁防并发重入。仅打开聊天、切 swipe 不会自动立刻补摘。AI 回复完成事件只重算现有派生状态，不在此刻调用提取。因此刚读完的一轮，其新物品和关系可能尚未进台账，可手动逐楼补摘。

[源码 src/memory/engine.ts:1825–1882](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1825-L1882) [源码 src/memory/engine.ts:744–814](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L744-L814)

这不是完全不影响前台：开场缺时间锚点时会先等整理；唯一旧缺口会尝试等待/补齐；仍有缺口或多个缺口时中止正文生成，提示用户补摘。正常无旧缺口时允许正文与后台整理并行；整理失败默认可重试，全部失败记录错误。

[源码 src/memory/engine.ts:534–621](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L534-L621) [源码 src/memory/engine.ts:965–989](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L965-L989)

### 4. 持久化原件在消息上，台账是重放结果

每个楼层的 `extra.bbs_leaf` 存放稳定叶子 ID、summary、delta、生成时的 swipe 页码和时间。items/scenes/npcs 当前列表是派生产物：从空状态起，按楼序重放当前有效叶子的 delta；上层压缩摘要不参与台账重放。这样无需让模型“反向推算”怎样撤销一个道具变化。

[源码 src/memory/engine.ts:1055–1109](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1055-L1109) [源码 src/memory/apply.ts:1406–1436](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1406-L1436)

派生值更新 Vue reactive 状态，叶子通过宿主 saveChat 防抖 1500ms 落盘；chat metadata 保存压缩节点和 chat 层变量模板，不另存台账快照作真源。手动改台账也是把 op 合并到最新有效叶子的 delta 再重算，因此没有有效叶子时不能添加；手动修正随该楼一起回退，非独立永久配置。

[源码 src/memory/store.ts:55–150](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/store.ts#L55-L150) [源码 src/memory/apply.ts:1710–1725](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1710-L1725)

### 5. 删除、切页、重生成与普通编辑的语义不同

删除消息或切换 swipe 后，200ms 合并重算，只重放当前 swipe 有效的叶子。页码不符的旧叶子留在旧页，不参与当前台账；切回原页可恢复。普通改正文不按文本 hash 废除叶子，所以改错字不会丢台账，但如果改了故事事实，台账不会自动重新理解新事实，需要重摘/手修。正文内物品旁注有专门反向解析通道。

[源码 src/memory/apply.ts:659–687](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L659-L687) [源码 src/memory/engine.ts:1805–1882](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1805-L1882)

手动重摘某楼时，用该楼之前状态作输入，旧叶子保留到成功才替换且维持其 ID，失败不动旧数据。注意：重摘较早楼仅替换该楼，不自动重做其后所有 AI 提取；后续已经保存的 delta 仍会重放。后者是据单楼替换及重放路径的推导，说明“支持回退”并不等于对任意历史事实改写自动消除所有后续语义矛盾。

[源码 src/memory/engine.ts:683–709](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L683-L709) [源码 src/memory/apply.ts:1406–1436](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1406-L1436)

### 6. 去重依赖稳定命名和提示词，非完整实体消歧

物品和 NPC ID 是去首尾空格、转小写后的名称，地点 ID 是规范化路径。相同名字能稳定引用，异名/外号不会自动统一；物品 schema 没有 owner 字段，同名的多人独立库存并非原生模型，不能把它当严格 RPG 背包系统。物品同名 add 会累加，不会因“重复语义”自行去重，防重复结算主要依靠既有状态、最近 8 条变动、提取规则与正文旁注。

[源码 src/memory/apply.ts:389–420](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L389-L420) [源码 src/memory/types.ts:22–41](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/types.ts#L22-L41) [源码 src/memory/apply.ts:1129–1265](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1129-L1265) [源码 src/memory/apply.ts:1406–1436](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/apply.ts#L1406-L1436)

### 7. 批量补摘不能等同于补齐历史台账

批量路径源码明确只保留各楼 summary 和起止时间，即使模型返回物品/地点/计划也丢弃。块失败时才回退逐楼路径，此时会产生完整台账。FAQ 对“批量只摘要”与源码一致；但“交给后续逐楼自动摘要补”不能读作已批量成功的旧楼会自动补齐：pending 依据有效叶子，成功批量楼已有效，不再自动入队。补历史台账需逐楼重摘，这是由批量落叶和 pending 条件组合推导。

[源码 src/memory/engine.ts:1364–1389](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1364-L1389) [源码 src/memory/engine.ts:445–465](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L445-L465)

### 8. 给人看的清单与给模型的注入共用数据，注入会裁剪

主模型不是收到全量详细数据库。地点只展开当前节点及祖先；物品在身边/当前地点展开，远处寄存品保留简表；NPC 按主要角色、在场、附近、不在场分档。以 system 角色通过 setExtensionPrompt 持久槽注入，最新 AI 已整理时状态在其后(D1)，未整理时放其前(D2)，避免把旧状态当作刚结束的状态。

[源码 src/memory/inject.ts:535–636](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/inject.ts#L535-L636) [源码 src/memory/inject.ts:37–95](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/inject.ts#L37-L95) [源码 src/memory/inject.ts:668–683](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/inject.ts#L668-L683)

主模型注入开关只影响输出给主模型的内容，不停止副 API 记录。`summaryOnlyMode` 返回空台账状态注入，内部数据、页面与查询继续使用，物品/变量正文旁注也不再写入；但它仍保留摘要与时间标签机制，不能称为完全不改主对话的“纯只读台账模式”。

[源码 src/memory/inject.ts:535–636](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/inject.ts#L535-L636) [源码 src/memory/engine.ts:1055–1109](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L1055-L1109) [源码 src/memory/inject.ts:668–683](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/inject.ts#L668-L683)

## 对通用性的判断

源码证据：核心字段是通用的物品、人物、地点及其增删改协议；输入直接取聊天正文和常规人物卡信息，自定义变量为空时不附加变量协议，因此不要求卡作者预先写 MVU/专属状态栏。

[源码 src/memory/prompts.ts:334–425](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/prompts.ts#L334-L425) [源码 src/memory/engine.ts:303–343](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/engine.ts#L303-L343) [源码 src/memory/prompts.ts:978–1013](https://github.com/baibai-git/ST-BaiBai-Book/blob/5c8a6b60d8c1185e169c46d43f63fce7d35d8583/src/memory/prompts.ts#L978-L1013)

推论：它的通用性来自“通用语义提取 + 固定结构 + 固定浏览界面”，而不是自动理解任意卡的所有规则。基本游玩查询可以跨卡，复杂数值、同名多持有人、别名、对过去事实改写的依赖修复仍需额外契约；误提取也需要用户可修正和可追溯的入口。未做真实模型跨卡成功率或性能测量，不将源码设计当作实测效果。
