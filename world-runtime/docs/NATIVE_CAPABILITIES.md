# 原生能力与迁移边界

## 章节和知识
作者操作可提交 `mark_chapter {title}`，与正文、来源和outbox共同保存。知识/章节窗口提供当前分支的原文摘录和人物、事实、原文搜索。摘录是确定性截取，不伪称人工或模型语义摘要。修订分支自动排除旧未来来源。

导出的 JSON 知识包内有 world.md、characters.md、各人物页、relations.md、events.md、chapters.md、plot-threads.md，附世界/分支/快照/来源。它是 OKF-inspired，不宣称规范认证。默认玩家视图；只有显式作者视图导出包含隐藏资料。

## 数据模板
支持 `{{char}}`、`{{user}}`、`{{getvar::trust}}`、`{{#if trust}}…{{else}}…{{/if}}`，以及 `{{#each characters}}{{name}} {{id}}{{/each}}`。
循环集合限定 characters、relations、inventory、facts、goals、plotThreads；八层、每集合100项、输出预算限制。不执行 JavaScript、表达式、属性遍历或 setvar 宏。读取的模型视图先完成可见性筛选。

## 生命周期与变量
卡片 `extensions.story_runtime.rules` 为最多64项数组：

```json
{"event":"input","when":{"variable":"trust","equals":1},"operations":[{"op":"increment_variable","key":"trust","amount":1}]}
```

input → before_generate → 模型 → model_output → 唯一世界提交 → post_commit。
前三个可写阶段的 operations 先暂存，最终同轮提交；预览、取消、失败不写入，同run重试不重复。display 和 post_commit 仅允许文本，不允许状态操作。post_commit 是提交后只读通知，不是任意外部副作用回调。

变量有 card、world、scene 三个命名空间，操作 scope 默认world。card/world随当前世界分支持久化，不跨世界共享可变状态；scene仅本轮暂存，commit不写入。可用 {{getvar::card::key}}、{{getvar::scene::key}} 读取，默认getvar读取world。所有读取先按人物可见性过滤，没有隐式双向MVU同步。

## 分阶段文本规则
`extensions.story_runtime.textRules` 最多32项：

```json
{"stage":"display","pattern":"钟楼","flags":"g","replacement":"【钟楼】"}
```

stage 为 input、model_output、display。显示阶段只修改派生显示字段，原始正文、证据和导出不变。支持有限宽度正则原子、字符类、锚点与 g/i/u；不支持重复量词、组、分支或反向引用。复杂规则明确 unsupported 并保留原件，不静默全兼容。不执行旧ST/Risu脚本。

## 上下文与成本
长历史按完成的20场景块生成带来源ID的冻结摘录检查点，当前尾部继续追加；分支/来源版本与检查点决定epoch。预算外原文仍可检索，摘录不取代权威状态。

本地诊断仅显示哈希、字节共同前缀和首变消息，不等于供应商缓存命中。仅来自返回usage的cache tokens用于实际比例；缺失为unknown。

可显式配置每百万token价格：STORY_PRICE_INPUT、STORY_PRICE_CACHED_INPUT、STORY_PRICE_OUTPUT 和 STORY_PRICE_CURRENCY（默认USD）。无完整价格或usage就显示费用未知。失败/取消尝试仍计入账本，估算不是供应商账单或货币硬预算。

## 仍须如实保留的限制
任意旧JS/Lua、原宿主DOM/API、复杂递归世界书、任意正则、动态插件卸载未承诺零修改运行。三端设备和真实浏览器验收缺失。新能力不能使整个30票计划自动变成完成。

## 人物、关系和观察
create_entity 由宿主产生稳定ID，支持人物/组织/地点/物品与别名；update_entity 可编辑描述与锁定。关系支持称呼、修订、终止、有效时间与来源。终止保留历史，不删除旧证据；重复相同关系断言不追加重复项。

observe 明确记录 observation/rumor/belief，不直接修改世界真相。NPC日程可用 belief 前提，只有自己的认知参与判断；获得新观察后原行动可因前提失效取消。人物认知窗口与 compileContext(actorId) 不复制玩家私有对话。当前不进行付费NPC自动规划。

实体描述、关系、物品、变量、资料的私有值在读取模板/规则/模型上下文前裁剪。未标私有的旧字段仍按原公开合同处理。作者能修改，模型不能绕过锁。

## 资料修订
作者可提交版本化的大纲/参考资料，保留独立sourceRevision、来源commit；它们不是事实或必然未来。修改会推进head，旧提取按expectedHead拒绝；从旧提交fork可找回旧版本。原始角色卡仍保留，不原地重写导入原件。

## 流式连接
模型首响应和后续空闲超时分开；持续正常流式输出不会被固定120秒总时限中断。没有无限自动重试或自动换密钥。

## 第二轮修正说明

作者操作/修订的“事件说明”是作者audit，默认只在作者视图。另有“玩家可见叙事”字段供明确发布；旧作者记录按保守规则隐藏。关系导出与模型状态明确区分active/ended及有效期。普通日程条件按自身认知，world真相条件需作者明确选择。提交后通知随commit保存并可重连；不重复运行副作用。

checkpoint已持久保存在SQLite，关联actor、来源、可见性、摘要版本和覆盖ID；较早可见正文有查询召回。它仍是确定性摘录和词面召回，不是语义质量保证。新存档格式v2防止旧程序忽略audience；迁移前一致性备份保留在数据目录，失败不清空原库。

STORY_OPENAI_EXTRA_PARAMS可显式配置temperature/top_p/presence_penalty/frequency_penalty/seed/stop；受控白名单不能覆盖消息、工具、身份、认证或stream。本应用仍为JSON正文+operations模式，不启用tool calling。
