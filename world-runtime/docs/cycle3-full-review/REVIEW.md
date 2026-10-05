# Cycle3 独立完整需求与质量审核

日期 2026-10-05 UTC。冻结源码 172a8df057cf2f716a867fa4f70fed3b2f400fd7，父 12b0f306cde8a200ff7e200aa125419639c40bcc。唯一仓库为 dsh-tavern-recovered/Story-Runtime-Linux-0.1.0，目标 lurenyi4/dsh-tavern。本审核使用新上下文，未阅读本轮 cycle3-focused 结论；阅读了两份 cycle2 原报告。未改源码、ADR、许可证，未提交或推送，未使用 Codex CLI/新云任务或真实付费模型。

## 结论

**在下述已审范围内，本轮 Linux 代码正确性/维护质量复核通过，未确认新增 Critical、Major 或 Minor。cycle2 两项 Major 的修复均有真实执行证据。** 这不是四端产品完成、全部安全性质证明、远程CI通过或正式发布许可；Chromium 真实UI门依然阻断。不得用该代码门结论将完整验收门标 Done。

## 独立执行

- `node --test world-runtime/test/*.test.mjs`：163 tests/pass，0 fail/cancel/skip，退出0，`unit.log`
- `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs`：9 tests/pass，0 fail/cancel/skip，退出0，`actual-http-dom.log`
- 自写 `normal-flow.mjs`：普通合成故事的跨 input/pre/model/output 扁平序列、前置事实去重、新实体被模型关系引用、多记录族 ID 比对、保存草稿后重开提交、同payload receipt复用、不同正文冲突；全部通过。另三个10/20/30事件按 maxEvents=1 分批推进to=40，时间与 knownSince逐次正确，`normal-flow.log`
- 实际尝试 `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-browser.mjs`。HTTP通过；Chromium的 ProcessSingleton socket 创建遭环境 Operation not permitted，浏览器测试失败。`http-dom.log` 文件名是开始执行前命名，**内容实际是 HTTP+Chromium，不是 DOM证据**；DOM证据仅以上 actual-http-dom.log
- 自写探针首次因审核脚本漏一个闭括号出现 SyntaxError；修正审核脚本后通过。不是产品缺陷，产品源码未改
- 初始 checkout clean；测试后3份 docs/e2e-evidence JSON更新，是测试生成产物；同时观察到其他组的未跟踪 cycle3-focused-review目录，未打开或修改。没有恢复/覆盖任何并行产物

## 已看范围与证据边界

输入：原附件完整版结构、独立 DEVELOPMENT_PLAN 主体所有需求/设计/不变量/能力/场景/验收章节、CONFIRMED_REQUIREMENTS、TRACEABILITY、启动/授权地位与任务映射；当前 CONTRACTS v2、RECOVERY_AND_COVERAGE、ADR-LINUX、WORK_LOG增量、CURRENT_VALIDATION、PLATFORM_MATRIX、NOTICE和依赖清单结构、cycle2完整与聚焦报告。对原完整合订本一次读取发生输出截断，随后按独立主计划分段补齐主要计划内容；不声称逐字阅读所有附录的重复票据原文。

完整检查本轮产品源码diff：behavior/domain-state/model/run-identity/server/store六个改动文件及新增 identity-time测试；继续追踪真实上下游：server launch生成/结算/重开/作者动作/日程/自主入口；store身份元数据/事务/提交/分支/修订/运行保存/备份及版本迁移；domain reducer各操作家族；actor-view整份；model audience/contexts/checkpoint/recall/compactState/配置与结构回复；behavior生命周期；backup闭包/恢复；importer规范化/资源/报告；knowledge整份；host整份；UI的视图、动作、重试、SSE、修订及控制入口，并以实际app.js DOM套件核验。检查核心CI和继承部署触发策略、平台路径/矩阵。

这是一轮完整需求追溯与关键执行路径审核，不是保留上游全部几千文件逐行审计；未独立运行上游全部测试、真实设备或真实付费服务，未逐个鉴证所有依赖/素材许可。

## cycle2 Major 闭合证据

### S2-01：跨阶段新记录身份

`run-identity.mjs:1–27`以持久宿主UUID namespace和固定 operation位置/family推导UUIDv5。`store.mjs:587–610`持久保存run namespace；`server.mjs:250–359`将同一 operationCursor贯穿 input/pre/generated/output；`domain-state.mjs:264–272`每操作推进位置，与是否真正分配/去重无关；`store.mjs:675–687`正式重放读取相同namespace，旧entity reservation仍有兼容路径。

本轮实际163测试含真实HTTP模型读取关系/目标等ID→失败after-state→服务重开→仅重试结算，模型请求数保持1。直接自写组合测试又确认多阶段去重不会导致之后实体/关系/目标/伏笔错位，未只重复旧单一关系用例。新记录身份覆盖entity、relation、fact、goal、plot、schedule、reference及reference revision；belief/inventory用复合身份，本来没有随机主ID。schedule内嵌操作预检不借用外层操作cursor，不会挤占后续顶层身份。

没有以不再提供关系ID、禁止新建或删掉功能关闭缺陷。变更payload仍冲突；取消与事务回滚均保留。

### S2-02：事件有效时间

`store.mjs:951–952`先确定max(state.time,current.at)，用于当前事件条件/预检；`store.mjs:672–673,1017–1029`在同一advance事务中、正式applyOperations之前设定事件有效时间。关系validFrom/validUntil与认知knownSince因此读取正确世界时刻。事件取消仍记录原因；未把存储错误吞为领域取消。

实际测试包括多事件、不同时刻、锁失效取消、关系终止/新建、重开/fork、overdue取当前时间、第二事件写入失败导致整个advance回滚。独立新增分批maxEvents正例核验：还有due事件时不提前跳到to，最后事件完成才提交最终clock；knownSince仍是事件30而非最终40。未见新时间边界问题。

## Standards 复核

- 简洁复用：27行单一身份函数、一个持久namespace代替按对象家族继续扩张预留表。保持一个SQLite权威、薄DSH Session/JSONL投影、单一OpenAI-compatible JSON结算路径，无新Harness/服务框架
- 事件一致性：body/state/event/outbox/audience/notice同事务；host ACK不当成重新生成理由；expectedHead/sourceVersion/幂等与失败注入测试仍通过
- actor与秘密：静态检查中央actor投影、作者audit/publicNarrative、模型/知识/UI使用链；正常privacy回归通过。没有第三方攻击或实用漏洞复现，不将这些证据称安全认证
- staging/草稿/重开/fork：run seed落盘并独立于canon；结算重试不再调用模型；分支引用after-state和可达历史，source/head过期被拒绝；保存后的操作顺序是当前合同，不支持重排序冒充相同重试
- 备份迁移：仍先一致v1快照与flush，后事务更新v2标记；未知版本/形似schema拒绝；恢复新目录、闭包校验、投影显式重建。单测不证明Windows目录flush或硬件断电
- 通知/checkpoint：通知只读且事务持久，重连返回已存notice；checkpoint存SQLite按actor/source/visibility/cut生成epoch，有界早期来源召回。摘录不是语义总结，prefix byte诊断不是供应商命中
- 发布/CI/许可：core workflow contents:read、锁定Node/依赖、Linux核心+HTTP/DOM；未远程执行。Pages与manifest仅workflow_dispatch。保留AGPL/第三方来源与NOASSERTION提醒，未授权Issue/Release/Pages。没有改变原ADR或缩范围制造验收通过

## 全需求追溯

| 范围 | 本轮判定 |
|---|---|
| U-01 | Linux自动检查通过；Android原生WorldMode桥未实现；Win/mac与Chromium门仍开 |
| U-02/U-03 | ST JSON/PNG、Risu CharX/module/resource原件/报告有实际回归；广泛许可样本与完整媒体、大导入仍开 |
| U-04/U-05 | 受限声明式模板/变量/生命周期/正则/面板/动作存在；此次CAP-03身份缺陷关闭；不是旧插件全兼容，代表性迁移体验未全部验收 |
| U-06 | 可选参考，没有专有轮换/多协议扩张 |
| U-07/U-08 | 持久事务、关系基数/生命周期、来源、分支、恢复通过本轮核验；跨阶段身份与时态major关闭 |
| U-09 | 有界事件、错误认知、观察更新、默认关闭自主/玩家暂停存在；自然度与长期规划效果未验收 |
| U-10 | usage unknown、全部尝试计量、价格估算、稳定上下文/持久checkpoint有机制证据；真实成本/命中收益仍开 |
| U-11/U-12 | 单一Chat Completions路径、tool calling disabled明确；固定DSH薄接入，不嵌第二平台 |
| U-13 | 动态卸载可选且未实现，不升级为主线阻断 |
| U-14 | 章节/检索/证据/伏笔/参考资料/保守分支修订存在；不是长篇质量完成证明 |
| U-15 | 根许可/来源/依赖与发布边界保留；非逐项素材法律认证 |
| U-16 | 本轮独立代码门通过，原开放门保留；不能据此宣布全部任务/正式产品完成 |

CAP-01/02/03/04/05/06/07/09：有界实现及正常/拒绝路径测试；CAP-08媒体体验部分，CAP-10可选。I-01～18及I-20在当前机制/测试覆盖范围未发现新增违反；本轮重点确认I-12稳定重放和I-15有效时态。I-19未承诺。不是穷举任意输入组合证明。

B-01～18均在主机制及单测/HTTP/DOM范围有证据：多关系、位置、断流/幂等、事务失败、ACK恢复、stale、修订/fork、错误认知/传闻、取消/到期/空队列、预览取消、伏笔、模块报告、秘密投影与usage unknown。B-12的时态新组合现已通过；B-17与其他安全相关项仅正常功能及既有防御性测试核验。

T-00/02/03基线/宿主主体有证据；T-04～06核心、T-14/15/18/19相关新major解除；T-07/08基础导入但生态开；T-09大导入/取消/内存开；T-10～13有限能力有实现；T-16/17保守修订；T-20～22持久检索/计量有实现；T-01/24多端、T-23真实质量费用开；T-25相邻迁移通过但跨端恢复开；T-26可选；T-27候选来源记录存在；T-28本轮完整审核通过需与另一独立组结果合并；T-29不能标完整交付完成。

## 剩余门与下一步

无需针对本轮未发现的问题制造源码修复。保留当前冻结身份、将两组独立结果与日志按原记录追加，然后按原用户授权推进。真正完整交付仍需Android原生实现/设备、Win/mac设备、可运行Chromium真实交互视觉、完整媒体/大导入进度取消/移动内存、代表性许可卡玩法和真实模型质量/成本预算评估。上游全量兼容、远程CI和正式分发也不得借用本轮Linux结果宣称通过。
