# 2026-10-05 恢复基线与需求覆盖

状态：恢复和继续实现中，不是完整四端发布验收。

## 输入用途与实际基线
三个用户附件为同一开发计划的压缩交接包、完整合订本和启动说明；无产品源代码。压缩包经过路径/文件类型检查后解压，未执行其中脚本。已读取需求、主计划、领域词汇、来源、ADR、票据和双段审查；原 ADR/人工决定不改动。

从 Library 恢复 Story-Runtime-Linux-0.1.0.zip（版本1），包含2434文件。原归档声明基线403df2d1e4080e4846627a58572c6347e3eefc02、历史本地提交82032503c47f2d68d422c8689a3eeac54e884f43；归档不含git历史，因此不将这两个SHA冒充本地HEAD。本地为新初始化main。

Node24.19.0；锁定DSH0.1.5-rc.2。重新执行104/104世界测试、3/3真实HTTP测试、3/3实际app.js DOM集成通过。Chromium启动时ProcessSingleton socket被环境拒绝；一次获批升级执行同样失败，没有浏览器页面或截图，不能替代真实E2E。macOS/Windows/Android及真实付费模型未运行。

Git ls-remote目标仓库因shell Git无认证失败；主线程另查连接器访问。未推送、发Issue或Release。

## 覆盖矩阵（恢复时）
|需求|现有实现|缺口/后续|
|---|---|---|
|U-01四端|Linux Node/SQLite真实运行|三端启动适配及实机验收；浏览器限制|
|U-02 ST|v1/v2/v3 JSON、PNG、开场及报告|更多覆盖样本与玩法|
|U-03 Risu|CharX/module.risum/资源/未知保留|复杂行为逐项迁移，不许静默全兼容|
|U-04/05插件等效|声明式按钮、变量、条件模板、面板|循环、生命周期、分阶段正则、命令和作用域|
|U-06可选参考|手动配置与明确错误|无必须实现的专有协议|
|U-07可追溯世界|SQLite正文/状态/outbox原子提交、取消恢复|补完长期摘要/章节/知识导出|
|U-08关系|有向多值、来源与人物认知|证据交互、更新/锁定、稳定别名检索|
|U-09动态世界|有界日程、自主开关、玩家决定暂停|目标来源与角色视角决策验收|
|U-10成本|稳定正文历史、usage未知、有限请求|epoch/前缀差异诊断、手动价格，真实A/B需预算|
|U-11单接口|Chat Completions流与取消|首响应/空闲超时、额外参数与明确能力声明|
|U-12参考|复用DSH Session/JSONL及来源记录|继续保持薄接入，不新加Harness|
|U-13可选卸载|未实现|可选，不阻断其他目标|
|U-14长篇参考|伏笔与分支修订|章节、可追溯摘要、知识页|
|U-15开源|AGPL底座与来源保留|交付清理/许可证复核；仓库访问待解决|
|U-16流程|规划包和历史独审保留|本次TDD、覆盖证据与新的独立审核|

## 实施顺序
1. 已完成归档恢复与重测，保持旧模式和ADR不变
2. 补长期知识/章节/关系查询与可读导出，全部通过唯一提交路径，先红后绿
3. 补声明式模板/生命周期/有限规则，以及上下文和费用诊断
4. 平台启动检查、真实API/DOM回归、独立需求与质量审核；真实浏览器和其他系统不能伪报
5. 只将经过审查的源码提交到用户目标仓库；访问未解决时保留本地成品

新代码只为已列缺项与验证增加，不建立微服务、供应商平台或任意代码执行能力。

## 继续实现后增量（2026-10-05，待修后独审）

- 章节标记、来源摘录、知识包与短中文/别名搜索通过真实SQLite、HTTP及实际app.js DOM新流程
- 模板循环、card/world/scene三命名空间、输入/生成前/输出/提交后通知，阶段正则；复杂语法明确拒绝，旧normalizer v1卡片不自动启用新行为；备份可按原版本复核
- 新实体由宿主产生ID；有向关系可修订/终止/锁定/称呼并保留来源。goal/日程/物品有sourceCommitId；相同关系断言去重
- NPC认知视图不复用玩家私密对话；observe区分观察/传闻/认知，不更新世界真相；belief条件日程已验证错误认知→行动→观察纠正→取消后续动作
- 实体描述、关系、物品、变量与参考资料可标私有；模板规则读取也经过actor裁剪
- 大纲资料明确非正史，保留资料版本与来源；编辑推进head使旧提取拒绝，旧分支版本可查
- 20场景块的来源摘录检查点按分支/人物/来源形成epoch，静态资料与历史前缀可诊断；本地字节诊断不是供应商命中证明
- usage只据真实字段，手动价格不重复计缓存tokens；缺usage费用unknown；首响应/流式空闲超时分开
- 桌面入口和原生数据路径补齐，help/version无runtime副作用；Windows/macOS未实际运行，Android原生APK/contentURI/storage桥仍缺实现与设备验收
- Pages/manifest自动发布改手动；新README区分本fork入口与上游安装器；NOTICE、锁依赖清单保留许可证。原归档清单不再冒充本轮文件哈希

## 未关闭而不能改scope消除的门

1. Chromium当前环境socket限制，真实浏览器UI/视觉截图仍blocked；DOM验证不能替代
2. macOS/Windows实机未运行，Windows目录flush语义未验证；Android新世界模块尚未接入原生APK/文件URI/驱动，不宣称四端成品完成
3. 真实卡片生态广样本、长期自然度、人类复核、真实供应商费用/缓存A/B需可用样本/设备或明确预算；当前未付费
4. 复杂ST/Risu行为有逐项不支持报告；不以有限正则/声明式迁移冒充完整旧插件兼容
5. 完整FTS/大型索引重建、实体全领域本体、精确因果修订不是当前实现；采用有界扫描、分支快照和保守未来丢弃的可检查方案
6. 本次新增源码需全新独立需求/质量两组审核。推送仓库不等于Issue、Release或Pages发布

本表保留四端及原生功能目标，不把未测/未实现内容改为“需求已降级”。原ADR和独立覆盖审计原文未改。

## 第二轮修后待复核（不代替新独审）

上一聚焦F01–F06、全量M1–M3已逐项新增回归并修复。详见WORK_LOG和CONTRACTS v2；两组原FAIL报告完整保留。实际SQLite checkpoint和早期来源召回已替代只在内存重算/诊断的旧机制。作者audit不再作为默认玩家正文；公开叙事需单独提交。新数据逻辑版本2，旧版本1自动先备份再迁移，旧程序不得打开v2。

新增CI仅跑Linux核心/HTTP/DOM，不代表Chromium或其他平台。格式化、日志与测试版本将随新冻结SHA复核，修复者的绿测不能自行充当两组独审通过。

## 第三轮修后待复核
cycle2新Major（非实体暂存ID与事件有效时间）已补真实HTTP/SQLite红绿回归，统一run操作身份及原子有效时刻实现。两份cycle2 FAIL报告/独立日志保留。此处不自行标独审通过；以新冻结SHA上的两组全新复核为准。完整多端、真实UI、媒体/大导入、广卡与真实质量成本门保持原状态。

## Linux media/import slice

Separate branch from source172a8df: CAP-08 now has all validated local image/audio previews, T-09 has binary progress, worker parsing, explicit preview/accept, cancel/close, real-process interruption recovery and conservative orphan cleanup. Final local validation: 171 unit and 10 actual HTTP/DOM tests pass. See MEDIA_IMPORT_SLICE.md for precise implemented boundaries and evidence. Broader real licensed cards, full media/HTML behaviors, mobile memory and real device/browser acceptance remain open. These tests do not self-approve the new slice; two fresh independent reviews are pending.

### First media-review repair

The f26cc35 slice was rejected by both independent reviewers. Their normal large-import backup and post-rename fsync findings are retained unchanged in media-focus-review and media-full-review. Shared64MiB per-file bounds,128MiB/2000-file current-footprint admission, truthful completed-with-durability-warning and restart reconciliation now address those paths. Failure cleanup and media lifecycle/decoder messages were also repaired. Final175unit/10HTTP+DOM checks pass; the original independent60MiB backup/restore test also passes unchanged. This does not self-close the review gate or any outstanding real-device/community-card/model-quality requirements.

### Normalized-content follow-up

The080b9dd full review found an ordinary normalized-card complexity mismatch plus upload cleanup lifecycle gaps. All three were reproduced before repair. A common normalized policy now governs preview/registration/read/world/backup/restore; normal5000-entry lorebooks and other valid structures survive complete HTTP backup/restore/reopen. Over-budget expansion is rejected before acceptance, without dropping raw values. Cleanup ownership survives history rotation and primary IO errors survive cleanup failures. Exact threshold tests and finite-budget rationale are documented in NORMALIZED_CONTENT_CONTRACT.md. A new independent review pair is still required; all original device/real-community-card/model-quality gates remain open.

### Final Linux media-slice decision

Both new reviews PASS9bc7960 (media-final-focused-review and media-final-full-review). The worker/receive primary-error issue is closed. One optional importer rename-plus-cleanup double-fault minor remains documented; startup clears its temporary leftovers, and no registered-data damage was observed. This closes the reviewed Linux slice gate only; earlier “pending” statements are historical. Full Android/native/device/browser/community-card/model-quality goals remain open.
