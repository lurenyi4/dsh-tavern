# 第一轮实现后独立聚焦审核

- 日期：2026-10-05 UTC
- 唯一基线：`91ae6c9322f7ef66be4200590234ff073be80faf`，本地 main
- 审核者：独立原生子代理 focus_review_tavern_recovery
- 结论：**不能关闭附件完整目标；当前冻结版本需修正下列 5 项 Major。** 本审未证实 Critical 缺陷。四端交付仍有 Block 门，不能靠缩小范围消除
- 仅新增本报告目录和本地功能探针/日志；未改产品代码、ADR、原审计或许可证，未提交、推送、调用付费模型、发布云任务或使用 Codex CLI

## 输入与证据边界

读取根 AGENTS.md、原 LICENSE（GNU AGPL v3）、原始完整计划及 ZIP 解包计划相关条款、CODEX 启动说明定位、上一独立覆盖审计、RECOVERY_AND_COVERAGE.md、CURRENT_VALIDATION.json。原始完整 MD 与解包 DEVELOPMENT_PLAN_FULL.md 的 SHA256 一致：`5aa42d327eb3ba797aee32dcc3be0ce4354df879b1ca3b2a8028088fa4817cda`。

需求引用行号均指 `../../dsh-tavern-inputs/extracted/story-runtime-dev-plan/DEVELOPMENT_PLAN_FULL.md`。本审聚焦上一轮缺口，不替代另一独立组的全量审核和许可证法律审核。

本次独立执行 7 个测试文件：actor-domain、behavior、model、knowledge、usage-report、store-recovery、backup-closure，**90/90 pass，无 skip**，日志 `focused-tests.log`。其中包含真实本地 HTTP 用例。另执行 `functional-probes.mjs`，以正常本地故事数据确认关系展示、认知条件、暂存实体、长篇上下文、锁定日程行为，结果 `functional-probes.log`。探针记录现状，不表示发现的问题已修复。没有第三方目标、攻击流程或漏洞复现。

没有重跑完整139测试、8项专用HTTP/DOM组合或真实Chromium；139/8仍是实现者证据。本审不把已有DOM测试当视觉测试。未运行 macOS、Windows、Android设备，未做真实模型缓存/费用A/B。

## 发现及最小修复

### F-01 · Major · 暂存新实体的宿主ID不能跨生成到提交稳定存活

位置：`src/domain-state.mjs:141–152`、`src/behavior.mjs:48–50`、`src/server.mjs:40–45,51`、`src/store.mjs:362–367`（相对 world-runtime）。

input/before_generate 规则的 create_entity 在 dryRun 产生 UUID，新实体及 ID 进入模型上下文；最终 commit 又从权威旧状态重新应用原始 create_entity 并生成另一个 UUID。模型按收到的有效实体ID为该新人物设置位置，最终结算报 UNKNOWN_ENTITY。现有提示“本轮不能猜新ID”不能解决宿主主动展示了暂存ID的问题。

正常功能探针：input 规则新增旅人，读取暂存实体ID，然后以同批操作移动他，结果 `UNKNOWN_ENTITY`。独立创建并完成提交后的ID是稳定的，此问题只否定跨暂存/提交闭环。

最小修：宿主在 run 准备阶段分配并持久绑定内部操作ID/实体ID；以内部规范化操作送往提交，保持外部模型不可自行指定任意ID。或者在未完成此绑定前不要把暂存新实体作为可引用实体发送。补 input创建→模型引用→取消/重试/重启的一致性测试。

### F-02 · Major · 已终止关系重新以当前关系进入模型和知识包，且模型无法引用关系ID

位置：`src/model.mjs:44–57`，特别48行；`src/knowledge.mjs:26,37,39`；`src/domain-state.mjs:154–159`。

关系压缩只保留 from/to/type/detail，丢掉 id、status、有效期、双向称呼、来源。关系结束后仍进入“本轮公开状态”，模型无法区分离任成员和现任成员；允许操作的 update_relation/end_relation 要求id，提示却没有提供。知识导出和关系搜索同样不标终止状态；UI虽有“已终止”，不能替代模型/导出合同。

正常探针的 canonical.status 为 ended，而模型输入为普通 member_of；导出也只有 member_of和最后来源，没有终止或称呼。

最小修：当前关系视图过滤ended或显式携带status/validFrom/validUntil；保留id和必要称呼/来源。导出及搜索区分历史关系和当前关系。补“建立→称呼→终止→下一轮生成/导出”测试。对应需求387–403、1771行。

### F-03 · Major · 普通日程条件仍按全局真相判断，NPC认知路径只在显式belief条件中生效

位置：`src/store.mjs:494`，`src/domain-state.mjs:110–124,315`；认知视图`src/actor-view.mjs:3–16`。

显式 belief 条件闭环已经修复并通过真实store测试。但 advance 调用 checkPrecondition 时仍传 canonical state；普通 entityId/location 和 variable 条件直接使用世界状态。相同普通地点条件在真相视图为true，在演员视图为false，实际调度选取前者。不能据一个belief专用测试关闭“行动受自身认知约束”。

普通公开数据探针：乙实际在森林，甲认为乙在码头；“乙在森林才行动”在全局为true，在甲视图为false。

最小修：区分明确的世界合法性前提与角色决策前提，后者以actorState判断；两者不得含混使用。绑定调度actor并对角色条件使用同一投影，补普通位置/变量/观察更正与到期重验测试。保留现有合法性验证。对应需求725–727、B-09/10。

### F-04 · Major · 长篇检查点是有界重算摘录，尚非持久冻结的长期上下文机制

位置：`src/model.mjs:59–81`；`src/store.mjs:93–105`；`src/server.mjs:25,41`。

contextCheckpoint每次从快照重算，SQLite没有检查点/epoch记录。85场景时cut=60，但摘要仅保留场景40–59的240字摘录；0–39没有累计摘要或模型检索通路。knowledge-search仅面向用户HTTP查询，未接入compileContext召回。更早文本仍在权威数据库不是模型能继续利用它的证据。diagnostic是内存Map，不能当持久checkpoint。

普通探针：第0场景的独特早期线索不在85场景检查点或正文历史中。现有“epoch稳定”测试只验证65→66场景输出字符串相等，未验证重启持久记录、权限变化、新周期或早期线索召回。

最小修：持久保存可重建的冻结检查点记录（分支/actor/来源版本/可见性版本/覆盖范围/来源ID/内容及摘要版本）；跨块累计或有界检索早期来源，修订与权限改变显式失效新epoch。按原方案允许摘录实现，但需要保留长期证据召回闭环，不必引入每轮额外模型调用。补85+场景早期伏笔召回、重启、fork/revise撤回测试。对应需求366、826–831、1846–1847。

### F-05 · Major · 后加锁使到期日程永久pending并停止推进

位置：`src/store.mjs:494–504`，`src/domain-state.mjs:173,156,279`。

旧日程安排完成后，作者锁定其操作目标。到期预验证现在可能抛新增的 LOCKED_FIELD，但取消分支的允许错误列表只包含旧 LOCKED_FACT等。整个advance事务失败，日程仍pending；自动推进catch会关闭自治（`src/server.mjs:112`），而不是取消失效操作并继续队列。

普通store探针：安排乙移动→作者锁定乙→advance，结果LOCKED_FIELD且status=pending。

最小修：将预期的领域失效错误统一映射为可追踪取消原因，至少包含新锁定类型；不要吞掉数据库/系统错误。补实体/关系/变量在安排后被锁定、解锁后新安排、同批其他合法日程仍可推进测试。

### F-06 · Minor · post_commit通知不随重连恢复，且当前只覆盖生成提交路径

位置：`src/server.mjs:34,78,98–102,112`。

生成成功路径确实调用了post_commit，这是上轮缺口的实质修复；规则只读不能改变世界。但notice只通过活跃SSE发出，已完成运行重连的committed事件不包含它，普通快照也无通知记录。card-action/author action/advance提交未走该通知路径。

最小修：明确生命周期合同的适用提交类型，并保存可幂等恢复的通知结果或事件记录；重连返回同一次通知，不能重新执行副作用。若设计明确仅生成生命周期，应在导入报告/帮助中说明。补提交瞬间掉线→重连测试。此项不应抬高为正文持久化失败。

### G-01 · Block · 完整四端和视觉验收仍未达成

证据：`PLATFORM_MATRIX.md:3,9–14,77–79`、`world-runtime/docs/CURRENT_VALIDATION.json`。

Android新增世界模块native APK/host storage/content URI桥没有实现，不只是无设备；macOS/Windows只存在入口和Linux上的路径测试，原生实机未运行。Chromium当前环境ProcessSingleton socket受限，无实际页面/截图。文档已诚实标示，不是声明造假；但这些仍是原需求的未关闭门。

关闭条件：保留U-01目标，完成Android原生实现，逐端记录安装/导入/生成取消/kill-reopen/备份恢复，真实浏览器视觉交互记录。需要设备/运行环境时请求，不能用远程网页或Linux模拟路径替代。Linux局部成品可标候选，不能写完整附件Done。

## 上轮缺口核对

| 领域 | 本轮判断 | 证据与剩余边界 |
|---|---|---|
| 新人物/组织/地点/物品hostID | 部分修复 | kind四值和宿主UUID已存在；独立提交稳定，暂存引用见F-01；物品库存仍按文字item识别，与item实体没有统一外键 |
| 关系修订/终止/锁定/去重/来源 | 部分修复 | add去重、update/end、称呼、锁定及sourceCommitId可用；模型/知识表示见F-02；双向称呼没有公开/私下细分，完整多来源证据未达成 |
| NPC actor-view/observe/belief | 部分修复 | NPC上下文不复用玩家正文；观察/传闻/认知分型，不直接改真相；显式belief日程更正通过，普通条件见F-03；未接NPC模型规划，但原需求不强制每NPC独立模型 |
| 私有关系/物品/变量/描述/规则读取 | 已修基础投影，不能泛化完整保证 | actorState及runBehaviors采用演员投影，现有正向隔离测试通过；未做攻击测试；命名空间visibility元数据仍建议全量组静态复核，不能称全面安全认证 |
| post_commit | 部分修复 | 成功生成已调用，通知持久/重连及其他提交见F-06 |
| 变量scope | 已修基础合同 | card/world/scene distinct，scene dryRun暂存不持久，取消测试通过；仅world形式when条件，尚非全部作用域表达能力 |
| 持久检查点/epoch | 原需求未完成 | F-04；新增字符串epoch和分块摘录有价值，不等同持久冻结上下文 |
| 章节/知识包/分支撤回 | 已修基础合同 | 章节mark、来源摘录、中文别名搜索、知识文件、fork后不含未来、重启测试通过；不是全文索引/语义摘要/长篇自然度验收 |
| 模板/分阶段正则 | 已修有限合同 | 数据型if/each、边界限制、input/model_output/display；复杂正则显式不支持，旧normalizer不偷开新规则，90测试含恢复验证 |
| 成本计量 | 已修本地账本和估算 | unknown不记免费、缓存token不重复计价、失败attempt保留；真实供应商缓存费用A/B仍未验证 |
| 恢复一致性 | 已有Linux回归支持，新增组合需修 | 事务/备份闭包/分支/旧normalizer恢复测试通过；F-01/F-05为新组合问题，不否定全部旧恢复实现；四端持久性未验收 |

## 建议下一轮验收顺序

1. 先修F-01/F-02/F-03/F-05，补普通功能回归；避免为了过测试禁止本来需要的运行中新实体/关系生命周期
2. 完成F-04的持久周期与长期证据召回，保持来源、分支撤回和actor投影一致
3. 收敛F-06生命周期合同，并让重连验证覆盖通知
4. 冻结新SHA，独立重跑新增回归及相关现有套件；此报告的90绿测只能证明旧测试，不能当缺陷关闭证据
5. 继续四端、真实UI、代表性卡片及真实费用/叙事质量门。无预算不发付费请求，无设备不伪造结果；原需求保持open
