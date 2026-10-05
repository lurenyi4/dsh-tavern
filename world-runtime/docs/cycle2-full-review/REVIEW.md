# 第二轮独立全需求与质量审核

日期：2026-10-05。冻结源码：12b0f306cde8a200ff7e200aa125419639c40bcc；父版本：91ae6c9322f7ef66be4200590234ff073be80faf。独立原生审核代理；未读本轮另一审核结论；未修改源码/ADR、未提交/推送、未创建外部任务。审查依据是原始附件计划、U/CAP/I/B/T 表、ADR-LINUX、当前源码/合同及上轮完整报告。不是对保留上游几千文件逐行安全认证。

## 结论

**当前 Linux 修复候选尚不通过代码质量门：发现两个新的功能正确性 major。完整产品目标同样未完成，但两者应分别记录。** 原有 156 项单测通过不能覆盖新发现的跨阶段身份及事件有效时间问题。不能以缩减四端、媒体或真实成本目标消除原门。

## 独立执行证据

- `node --test world-runtime/test/*.test.mjs`：156 pass，0 fail/skip，退出 0；`unit.log`
- `node --test world-runtime/test/e2e-api.mjs`：3 pass，0 fail/skip，退出 0；`api.log`。使用真实本地 HTTP/SSE/SQLite/DSH，无付费模型
- `node normal-flow-probes.mjs`：普通合成故事，两个缺陷均复现；`normal-flow-results.txt`
- 未独立运行 DOM/Chromium/上游全量/实机/真实供应商，故不将作者声称的 9 HTTP+DOM、16 static 写成自己的核证结果
- 初始 checkout clean。随后观察到三份 e2e-evidence JSON 的并行测试写入；本审核没有运行会写这些文件的 DOM 测试，没有回滚别人的产物

## Major S2-01：非实体记录的暂存身份仍与提交身份不一致

定位：`domain-state.mjs:439-446`（新关系随机 UUID；新 facts/goals/plotThreads/schedules 亦用 randomUUID），`server.mjs:252-274,335-354`（只为 entityIds 预留，并将各阶段操作重放合并），`model.mjs:265-277`（向模型暴露暂存关系 ID），`store.mjs:650-658`（正式提交再次应用操作）。

普通流程：before_generate 声明式规则新建“同事”关系 → 暂存状态含关系 ID → 模型按公开状态合法 update_relation(id) 描述合作进展 → 正式提交重放 add_relation，生成另一 ID → update_relation 报 UNKNOWN_REFERENCE。独立探针结果：Relation is not in the current branch，head 仍为 null；事务回滚是正确的，但正常故事无法结算。重试同一已保存草稿仍找不到该暂存 ID。

实体 ID 的修复是有效但不完整的；同样问题可影响其他带 ID、在后续阶段可引用的新增记录。不要将全部家族均声称已独立复现，本轮直接实测关系家族。

关联 U-05/U-07/U-08、CAP-03、T-11/T-14，阶段一致性与恢复可用性。

最小修复：统一为本 run 中所有可跨阶段引用的新记录提供稳定身份分配/规范化决定，而非只补 create_entity。staging、保存草稿、commit、restart/settlement retry 使用相同决定；保留模型不得任意指定全局身份的边界。回归至少包括 before_generate 建关系、模型更新同关系、重开后结算，以及目标/日程引用的同类用例。

## Major S2-02：到期事件先应用变化、后推进时间，写错关系与认知时态

定位：`store.mjs:653-658` 先 applyOperations 后 transform；`store.mjs:987-994` 在 transform 才设置 next.time。`domain-state.mjs:331,446,514` 分别从 state.time 写 validUntil、validFrom、knownSince。

普通流程：世界时间 0，安排时间 10 到期事件终止“同事”、建立“朋友”、记录观察。advance(to=10) 后世界时间确为 10，但同事 validUntil=0，朋友 validFrom=0，观察 knownSince=0。多次到期事件会用上一事件时间，错误具有系统性。状态/知识导出/模型完整保留这些字段后，反而会传播错误的时态证据。

关联 U-08/U-09、I-15、B-12、T-14/T-15/T-18。

最小修复：在同一权威事务中确定事件有效时间并先更新事件计算状态，再验证/应用该事件 delta；不得先发布单独时钟提交破坏原子性。明确 overdue 的 max(currentTime, dueTime) 语义。回归同一 advance 多个到期时间、observe/关系新建终止、失败事件、fork 与 reopen。现有锁失效取消策略继续保留。

## 已确认改进（不复报上轮已修项）

- 作者 audit/publicNarrative 与 audience 同事务写入；旧作者未标记记录保守隐藏；玩家 projection 去掉操作日志。model/knowledge 共用 visibleSnapshot，关系 ID/status/有效期已传出
- actorState 统一裁剪角色、事实、关系、物品、变量；runBehaviors 的条件和 append 内部用 actorState。曾检查 post_commit 传 canonical 的疑点，沿 append 实现核销，不构成新问题
- 锁实体/关系/变量的 LOCKED_FIELD 进入日程可预期取消分类，不把数据库故障统统吞掉
- SQLite checkpoint 元数据持久化，epoch 含分支/人物/来源/可见性及 cutoff；查询驱动早期摘录召回存在。其功能是有界原文摘录，未冒充语义总结或供应商缓存
- v1→v2 在版本切换前 VACUUM INTO 一致备份，flush 文件/目录，再事务更新版本；未知版本和 schema 拒绝。该迁移及兼容测试包含在独立 156 项绿测中；不等于跨平台断电认证
- 通知在 commit 事务保存，重连读取；状态变更被 post_commit 禁止。KISS 保持一个数据库、薄 DSH 投影、单一 OpenAI-compatible JSON 模式，无新增 Harness/微服务/任意脚本执行
- 新 workflow contents:read，仅安装锁定运行时并运行 Linux 核心/HTTP/DOM，无部署步骤。README/旧 installer/站点保留上游来源并明确 fork 入口，package.repository 已指向目标 fork
- formatting 提高了可审查性；合同集中描述 v2，比靠压缩单行伪装简单更可维护

## 全需求追溯结论

| 需求 | 当前判定 |
|---|---|
| U-01 | Linux 有自动证据；Android 新 WorldMode 原生桥未实现；Win/mac 未实机；真实浏览器仍开 |
| U-02 | ST JSON/PNG 基础导入、原件及报告有回归；广样本未验收 |
| U-03 | Risu/CharX/module/resource 解析及报告存在；媒体完整体验、大资源与生态玩法仍部分 |
| U-04/U-05 | 有界声明式等效合理，无需恢复旧任意脚本兼容；CAP-03 受 S2-01 阻断，代表性迁移仍开 |
| U-06 | 可选，无供应商专有协议扩张 |
| U-07 | 事务/幂等/分支/恢复主体可运行，正常分阶段结算受 S2-01 阻断 |
| U-08 | 关系生命周期投影修复，但 S2-01/S2-02 阻断身份/时态完整正确性 |
| U-09 | 有界日程与认知条件存在；S2-02 待修；自然度仍需人工与真实模型验收 |
| U-10 | 计量、unknown、固定前缀诊断/持久 checkpoint 已有；实际收益未验收 |
| U-11 | 单一 Chat Completions，参数 allowlist、tool calling disabled 合同明确 |
| U-12 | 复用固定 DSH Session/JSONL，未引入第二 Harness |
| U-13 | 可选卸载未实现，不阻断主线 |
| U-14 | 章节/来源/检索/伏笔/分支存在，长篇效果未验收 |
| U-15 | 来源/许可/分发提醒存在；不是逐素材许可认证或正式发行许可 |
| U-16 | 原门保留；本轮新 major 未关，T-28 不能标通过 |

CAP-01/02/04/05/06/07/09：当前有受限实现；CAP-03 本轮发现缺陷；CAP-08 仍部分；CAP-10 可选。I-01～05、08～11、13、16～18 的主体机制通过独立套件；I-06/07/20 的修复实现检查未新增确认问题，不能将其称全面安全认证；I-12 的恢复路径保存 after-state，但跨阶段随机 ID 仍损害正常草稿复用；I-15 时态存在 S2-02；I-19 可选。B-01～18 均有对应主体用例/机制，但并非每个场景全部组合已穷举；B-12 新生命周期组合失败，B-17 的原 audit 缺陷已修。

T-00/02/03 基线与宿主复用证据存在；T-01/24 四端门开；T-04～06 主体恢复通过，S2-01 为新增结算问题；T-07/08 基础导入通过但生态验收开；T-09 大资源取消/目标内存开；T-10～13 有受限行为实现且 S2-01 需修；T-14/15/18/19 被 S2-02 影响；T-16/17 保守分支修订有实现；T-20～22 持久检索/计量有提升，非质量/命中承诺；T-23 真实质量成本待预算；T-25 相邻 v1→v2 已有实测，不再复报“无迁移”；T-26 可选；T-27 候选源码可继续审查；T-28 本轮不通过；T-29 不能宣称完整目标已完成。

## 发布与下一步

先修两项正常工作流缺陷，再对新 SHA 重跑专项红绿、156 单测、HTTP/实际 DOM、独立复审。即使 Linux 代码门关闭，仍须保留 Android 未实现、Win/mac/Chromium 未验收、广卡媒体/大导入、长期与真实模型成本质量门。推送开发快照与正式四端 Release 是不同授权/验收动作；本报告不授予任何发布权。
