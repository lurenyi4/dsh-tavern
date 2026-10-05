# 独立需求覆盖审计（实现进行中的快照，非最终验收）

审计时间：2026-10-05 11:18–11:24 UTC。审计者：独立原生子代理 `audit_tavern_requirement_coverage`。只读实现，唯一写入为本目录报告/日志。没有修改 ADR、产品代码或执行攻击测试；没有 Codex CLI、独立云任务、付费调用或外部发布。

## 结论与证据边界

**不能据当前实现宣称附件完整目标已经完成。** 当前代码有实质可运行 Linux 故事闭环，事务/备份/导入/分支方面覆盖较强。四端实测、NPC 自身认知决策闭环、完整人物关系维护、稳定上下文周期、长篇质量/费用对照、最终许可与发布门仍存在缺口。章节/模板/分阶段规则/费用诊断由实现者在本次审计期间更新，本报告明确评价所见代码，最终审核需重新冻结源码哈希及重跑。

状态含义：达成=所列有限合同有实现及本次测试支持；部分=部分能力存在而原条目仍有缺口；缺=未找到实现；未验证=有代码/资料或需平台/人工/外部证据但本次不能确证。候选蓝图不能自动上升为用户强制接口选型，达成也不代表四端/视觉/叙事质量通过。

本次输入：3 原始交接文件（原始 MD、CODEX_START MD、ZIP 的已解包内容）；确认需求、追溯表、30章计划、ADR、完整任务、研究证据、原计划 A/B 审核。原始完整版 MD 与解包 DEVELOPMENT_PLAN_FULL.md SHA256 同为 `5aa42d327eb3ba797aee32dcc3be0ce4354df879b1ca3b2a8028088fa4817cda`，其附件内容按拆分文件逐项核读。原报告只用于理解范围，未用于证明产品通过。

实查：world-runtime/src 全部模块、public/app.js 相关交互、各测试名称及关键断言、根 package.json/LICENSE/.gitignore、相关 GitHub workflows、来源文件。Node v24.19.0；本次 `npm run test:world` 返回 0，118 tests passed，无 skipped；日志 `unit-run.txt`。另独立运行 `node --test world-runtime/test/e2e-api.mjs` 返回0，3/3真实HTTP测试通过（`http-run.txt`）；`source-sha256.txt`记录报告结束时源码快照，不能冒充与先前测试运行完全同一快照。本次未重跑 Chromium，不把既有 ProcessSingleton socket EPERM 阻断当通过；未运行 Windows/macOS/Android。源码在同时变化，118 是该次运行的实测数，不是最终冻结验收数。

## 优先差距

1. 四端：新增核心绑定 Node `node:sqlite`、本地 fs、独立 loopback HTTP；没有 Android 的真实本地 storage/content URI/恢复实现证据。原 android 目录或上游桌面 CI 不等于新增 world-runtime 四端支持。
2. 人物与关系：`domain-state.mjs` FIELDS 没有 create/update entity、别名、组织建模、关系更新/删除；关系仅 append。同名初始人物可分开，但动态故事中无法增加新 NPC 或更新既有关系方向/称呼/有效期。
3. 人物认知：`compileContext` 固定调用玩家视图；`advance` 根据全世界状态前置条件执行预先声明操作，未提供 NPC actor-view 决策请求/观察获知流程。能证明真相与玩家认知分离，不能证明“甲基于错误认知行动直到观察纠正”。
4. 秘密合同：facts/beliefs/goals/location/schedules 有裁剪，但 relations/inventory/variables 没有可见性字段，人物 description 在玩家快照保留；当前合同只能把这些声明为公开资料。不能把已测私有 fact 哨兵泛化为所有状态字段都支持秘密隔离。
5. CAP：安全有限模板/规则有效；卡/世界/场景三变量作用域未分开；`post_commit` 被 grammar 接受但 server 完成提交后未调用该阶段；原 ST/Risu 脚本/正则多为保留禁用，无需补任意 JS，但必须提供清楚的迁移覆盖与示例。
6. 上下文：新 observability 是局部字节诊断与手动价格估算，不是稳定 checkpoint/epoch。`compileContext` 把变量模板结果放在 system 前缀；仅保留最近40场景/48000字符，超窗历史无摘要检查点回填。UI 搜索不是模型检索接入。
7. 发布：继承 push-main 清单回写和 Pages 自动部署工作流，需在推送前明确禁用或改为用户单独允许的发布入口；开源来源/素材清单尚不完整。

推荐独立模块：费用/上下文诊断（已有并行实现，不重复写）、独立发布/许可清单、平台 smoke 配置。共享 schema/domain-state/server/UI 必须由当前单 owner 协调；不建议为审计临时添加另一套 Harness、通用脚本沙箱、图数据库或插件兼容层。

## U-01～U-16 用户需求

| ID | 状态 | 实查证据及未关闭部分 |
|---|---|---|
| U-01 | 部分 | Linux Node/SQLite/HTTP 实测；store.mjs node:sqlite；其余三端、Linux真实UI、Android本地驱动未验证 |
| U-02 | 达成（有限格式） | importer/import-formats；v1/v2/v3 JSON、PNG metadata冲突、世界书/资源/开场，importer.test 与 HTTP 闭环；非全部私有语义兼容 |
| U-03 | 部分 | CharX card.json、legacy module.risum、映射表、资源原件/缺失报告；未来模块、脚本、部分媒体/高级世界书不支持，未测真实代表性用户样本 |
| U-04 | 达成（原则） | 原生声明式操作/模板/按钮，不仿真原DOM/API；unsupported报告存在；具体CAP范围见后表 |
| U-05 | 部分 | behavior.mjs 条件/循环/有限正则、card-action、权威面板；变量作用域、post-commit事件接入、旧玩法迁移正反例不足 |
| U-06 | 达成（可选边界） | openAIConfig显式单地址/模型，HTTP鉴权失败直接显示；未增加key池；无需整包ZerxzLib |
| U-07 | 部分 | store提交、事件、状态、outbox、分支、修订有真实测试；新人物、有效期、来源版本编辑、锁定范围/证据语义仍简化 |
| U-08 | 部分 | 有稳定人物ID、多值有向关系及sourceCommitId；仅新增关系，无关系修订/终止/称呼、实体运行时维护 |
| U-09 | 部分 | 默认关闭、限事件/时间自治、到期前置重验/取消/玩家决策暂停；无NPC认知决策/动机规划闭环、长期自然度未测 |
| U-10 | 部分 | 动态状态后置、immutable历史、单次结构化正文+delta、usage未知、手动价格/局部前缀诊断；checkpoint/epoch/真实缓存成本A/B未关闭 |
| U-11 | 达成（受限生成合同） | model.mjs标准POST chat/completions，SSE与usage测试；无tools循环，使用预定JSON正文/结算模式，不应宣称tools全兼容 |
| U-12 | 部分 | host.mjs真实锁定DSH Session/JSONL投影；pi式取消/attempt观测思想；未复用原Tavern request/settlement/prefix，路线差异须如实说明 |
| U-13 | 达成（可选处理） | 未实现热卸载，用户明确非刚需；不能列为必修发布阻断 |
| U-14 | 达成（研究参考） | 输入研究R15–R20齐全；实现借鉴不可变提交/伏笔/知识页；不等于长期小说质量通过 |
| U-15 | 部分 | 根AGPL、ST模板vendor声明、Risu byte map出处保留；完整发布素材/依赖NOTICE、隐私/许可证核对、公开仓库交付仍待完成 |
| U-16 | 部分 | 有计划/合同/日志与本次独立审查；本审不是修后最终双组审核；最终冻结/回归/发布授权记录待新审查者核实 |

## CAP 原生能力矩阵

| ID | 状态 | 证据与限制 |
|---|---|---|
| CAP-01 | 达成（有限grammar） | renderTemplate：if/else/each、getvar/char/user、有界迭代，无eval；behavior.test纯预览 |
| CAP-02 | 部分 | state.variables按world/branch持久化、clone暂存；没有独立card/scene命名空间；测试名“scoped”不可替代完整三作用域 |
| CAP-03 | 部分 | server launch接input/before_generate/model_output，visibleSnapshot接display；未看到提交后post_commit调用；重试不重新执行已保存操作 |
| CAP-04 | 达成（有限正则） | applyTextRules分input/model_output/display，拒绝重复/分组/回溯等语法；displayNarrative保留原文；不是完整ST正则 |
| CAP-05 | 达成（API/DOM层） | app.js人物、关系、物品、变量/伏笔/日程面板由同一snapshot；实际视觉与四端未验证 |
| CAP-06 | 部分 | 声明actions→card-action→commit；默认最多32；缺各原插件代表玩法转换样本和真实浏览器验收 |
| CAP-07 | 达成（声明式替代） | applyOperations白名单、有限规则，卡片不能读文件/key或运行JS；并非通用不可信脚本执行器 |
| CAP-08 | 部分 | 卡资源哈希且MIME限制、assetPath、UI展示；本地单用户全库哈希资源，无脚本readResource API；不宣称多用户/卡片之间保密授权 |
| CAP-09 | 部分 | 本平台HTTP/CLI/UI命令、作者声明式JSON；无需旧slash全复刻；旧命令迁移覆盖未完整列举 |
| CAP-10 | 缺（可选） | 没有插件实例generation/disposer卸载；不阻断主线 |

## B-01～B-18 场景

| ID | 状态 | 代码/测试证据及边界 |
|---|---|---|
| B-01 | 达成 | add_relation不覆盖其他关系；store/recovery tests many relations；组织只能当既有character ID表达，缺独立组织模型 |
| B-02 | 达成 | set_location单值，immutable operations/after_json记录历史，store tests |
| B-03 | 达成 | commits UNIQUE(world,branch,run)，payload_hash，HTTP幂等与durable draft；不保证API免费重试 |
| B-04 | 达成 | BEGIN IMMEDIATE事务，after-body/after-state/before-commit故障注入，正文/状态/outbox回滚 |
| B-05 | 达成 | HostProjection.drain按完整关联键及实际persisted内容查重，重开回补；HTTP与server tests |
| B-06 | 达成 | #commit与saveRun检查expectedHead；独立DB connections stale writer测试 |
| B-07 | 部分 | revise从目标前提交创建替换分支、丢弃未来；source_revision比较存在但无更新原始资料API；尚无异步提取/摘要任务 |
| B-08 | 达成 | fork由不可变commit ancestry与after_json构建，父后续不流入；store-recovery、knowledge tests |
| B-09 | 部分 | 玩家旧位置认知与NPC真相隔离有model test；无甲NPC视图生成/观察→认知更新闭环 |
| B-10 | 部分 | set_belief分开、prompt禁止把传闻作事实；无typed claim/observation操作及确定性“传闻不杀人”完整语义验收 |
| B-11 | 达成 | advance再次checkPrecondition、取消后不执行；store-recovery条件改变与取消测试 |
| B-12 | 达成（规则日程） | setInterval只唤醒有到期事件，advance共用commit；HTTP autonomy测试；非模型自主规划 |
| B-13 | 达成 | 空到期队列不发模型请求，不创建重复时间变化；store-recovery测试 |
| B-14 | 达成 | clone staging、preview不commit，cancel拒绝迟到提交；behavior真实HTTP测试及store取消测试 |
| B-15 | 达成（结构层） | plotThreads五状态含partially_resolved，sourceCommitId；不验证模型回收语义是否正确 |
| B-16 | 达成（所列legacy样本） | importer.test真实自建module/缺失/blocked资源，原件保存；未来格式显式unsupported |
| B-17 | 部分 | private facts/beliefs/goals、NPC位置、后台schedule请求前裁剪测试；只有玩家视图、公开集合无秘密metadata，不能泛化全字段 |
| B-18 | 达成 | unknown=null、attempt失败/重试账本、新usageReport partial/unknown，model/store/observability tests |

## 不变量补充

| ID | 状态 | 证据/缺口 |
|---|---|---|
| I-01 | 达成 | world状态写入集中createWorld/#commit/#fork事务 |
| I-02 | 达成 | expectedHead强检 |
| I-03 | 达成 | 关联键+payload_hash冲突 |
| I-04 | 达成 | 正文/events/state/outbox同SQLite事务 |
| I-05 | 达成 | 取消/clone/失败草稿不进正式提交 |
| I-06 | 部分 | 单值位置与many关系可用，但无关系唯一性/生命周期；重复add_relation形成重复项 |
| I-07 | 达成（玩家有限视图） | truth与belief独立；无通用NPC view |
| I-08 | 达成 | commit祖先链限定fork点 |
| I-09 | 部分 | goals/schedules独立；自然语言是否计划误标为事实仍依赖模型及作者审查 |
| I-10 | 部分 | source_revision比较存在，无正常source编辑版本递增入口 |
| I-11 | 部分 | fact.locked拒绝非author；其他字段无锁定合同 |
| I-12 | 达成（保存快照恢复） | after_json恢复不重抽/不调用模型；不是从原始operation重新生成随机ID的重放器 |
| I-13 | 部分 | 检索/章节现场重建无独立索引损坏；完整状态投影重建/FTS修复未实现 |
| I-14 | 部分 | 空operations不写events；重复关系、新set_goal或同值set_fact仍产生状态/来源变化，未做语义无变化去重 |
| I-15 | 部分 | scene/operation journal可追溯；部分状态元素无sourceCommitId、初始资料来源为整卡 |
| I-16 | 达成 | advance执行前再次校验 |
| I-17 | 达成（声明式合同） | entity查当前state、world/branch DB作用域、无外部脚本 |
| I-18 | 达成 | null usage与手动费用估算分离 |
| I-19 | 未验证（可选） | 未实现热卸载 |
| I-20 | 部分 | 每次重建玩家当前分支历史，私有集合过滤；无通用actor上下文权限/epoch体系 |

## T-00～T-29 任务映射

以下对完整票验收打分，不以“存在文件”判Done；候选票依赖门及最终批准由owner维护。

| ID | 状态 | 具体证据/余项 |
|---|---|---|
| T-00 | 部分 | 根package/lock与DSH固定依赖可查、测试可跑；本次git全未跟踪、HEAD不可作为上游真实commit，需恢复来源manifest与目标repo基线 |
| T-01 | 部分 | Linux node:sqlite真实文件/重开/backup测试；其余平台not_run |
| T-02 | 部分 | host.mjs真实DSH session接口；旧Tavern request/settlement/MVU/prefix未接入新链路 |
| T-03 | 达成（Linux scope） | 真实DSH JSONL投影/查重/ACK丢失/恢复测试；不外推所有宿主 |
| T-04 | 部分 | schema/reducer/稳定初始ID/单多值；运行时实体和别名、关系更新缺 |
| T-05 | 部分 | HTTP模拟/OpenAI契约+事务+UI存在；真实Chromium流程未通过 |
| T-06 | 达成（Linux backend） | 幂等/取消/故障注入/durable draft/投影修复/进程中断tests |
| T-07 | 达成（有限格式 backend） | CCv1/2/3 JSON/PNG、自建资源/替代开场/原件报告；UI视觉未验证 |
| T-08 | 部分 | legacy CharX/module闭环，unsupported明确；代表性真实格式扩展仍未验 |
| T-09 | 部分 | 有界包+staging原子注册+hash+backup；无导入进度/取消/自动GC，移动大资源未验 |
| T-10 | 部分 | literal/selective常驻worldbook、阶段有限正则；原平台高级触发保留禁用，覆盖表不足 |
| T-11 | 部分 | 有界模板/暂存规则/变量/按钮；三作用域及post-commit接入不足 |
| T-12 | 部分 | 无任意脚本开放且白名单测试；未进行目标宿主隔离原型，采用声明式退路即可，不必补通用脚本运行 |
| T-13 | 部分 | 面板/按钮/受控操作存在；四端、UI重挂载及旧玩法代表样本未完全验 |
| T-14 | 部分 | 有向关系列表与commitID；称呼、关系编辑/锁定/详情可点击证据不足 |
| T-15 | 部分 | 玩家过滤/短词名称搜索；无NPC ActorView、观察获知/模型历史有界检索接入 |
| T-16 | 达成（backend） | fork/select/revise与immutable祖先，测试父未来隔离；UI未独立浏览器验证 |
| T-17 | 部分 | 事实修订新branch丢弃未来；无纯文字修饰保留后果模式、旧摘要失效/新epoch持久机制 |
| T-18 | 部分 | goal/schedule/precondition/time/幂等可用；goal causal link、motivation、invalidated状态缺 |
| T-19 | 部分 | 无发言有到期事件执行、事件/时间预算、玩家暂停；无认知约束NPC选择与分层目标决策 |
| T-20 | 部分 | 历史原序/动态尾+新local prefix diagnostic；无freeze checkpoint/epoch、变量前缀不稳定 |
| T-21 | 部分 | SSE、usage/attempt、取消、手动价格；无latency/taskKind/通用共享call budget，自治零模型故无后台收费风险 |
| T-22 | 部分 | 新章节marker/截取摘要/知识JSON内Markdown/伏笔；无大纲资料导入、真正分层压缩记忆回填和规范验证 |
| T-23 | 未验证 | 本地契约测试不是同条件baseline A/B；真实模型/缓存/长篇人工复核需预算和样本，不可擅自付费 |
| T-24 | 未验证 | 四端实际设备主流程/后台恢复not_run；Linux Chromium阻断 |
| T-25 | 部分 | backup.mjs一致快照、闭包/hash、新目录恢复、拒未来schema；只有v1，无相邻版本迁移及迁移前自动备份 |
| T-26 | 缺（可选） | 未实现模块动态卸载，不得升格必需 |
| T-27 | 部分 | Linux说明/源许可存在；完整四端安装候选、NOTICE/素材清单/发布前干净验证未闭合 |
| T-28 | 未验证 | 本审仅覆盖审计，不代替修改完成后的两组新独立审核 |
| T-29 | 未验证 | 本审无发布操作；父任务用户push特定仓库授权须与Issue/Release/Pages授权区别 |

## 安全与许可/发布检查

- 需求不要求任意JS执行。输入明确允许P-03未证明时只做声明式规则；安全满足功能等效应采用数据语法/有限白名单，而不是导入脚本执行、eval、Function、VM或shell。World Runtime所见实现遵守这一边界。旧Tavern模式仍保留其原脚本能力，不能用新模块结论为整个上游所有执行路径背书。
- 根LICENSE完整AGPL；ST-Prompt-Template vendor README锁定commit并保留upstream/LICENSE；Risu byte map源码及IMPORT_WORK_LOG有commit/blob/AGPL来源。没看到汇总NOTICE/SBOM；完整依赖及素材法律兼容性未核准。本报告不是法律意见。
- `.gitignore`忽略node_modules、world-runtime/.runtime、.env、data和本地故事库；本次按文件名查未发现待发sqlite/env/pem/key。此检查不是完整秘密扫描；交付前必须对实际git staging清单和文本/素材来源再查，不输出真实秘密。恢复包含旧日志/报告/示例/文档，不能因是附件就推定每项公开无风险。
- `publish-runtime-manifest.yml` push main自动contents:write、git push；`pages.yml`可自动公开网站；`launcher.yml`触发上游安装/更新相关CI。仅push授权不应无意触发新增公开站点或发行产物，需禁用/手动化发布型工作流。保留合法来源，不改上游地址为目标仓库就假称整个安装链已验证。
- package.repository、安装说明和部分流程指向flizzywine上游；本次git remote -v为空。必须显式设置用户目标lurenyi4仓库，不按旧AGENTS默认推上游。
- DELIVERY_MANIFEST是原恢复包清单，修改后不再对应当前源码；最终发布需新哈希/版本/实测日志，旧“FINAL_*”报告不可当本轮通过证明。

## 真正用户范围与可简化的设计

必须保留：四端目标、ST/Risu内容资源导入、三类插件核心原生等效、连续状态/人物关系/动态世界、低成本单OpenAI接口、开源与诚实验证。不能静默将四端降为Linux网页、将U-05改为全部禁用、把关系图存储当动态世界完成。

可以简化：不复刻原插件API/DOM；不执行不可信JS/Lua；无热卸载也可主线验收；不必FTS/向量/Neo4j，只要有界检索解决真实数据规模与中文短词；不必高级出版工作台、3D关系图、微服务、多协议供应商或每NPC长期Agent；质量评估100–200场景/24张卡是建议预算，不能当无授权付费硬任务。可用保守全后续失效替代精确因果最小修复；可用有限规则自治替代昂贵规划，但应清楚说明自然/认知闭环尚未覆盖。

最小可信下一步：先冻结当前有限Linux合同与CAP迁移说明，修复真实不变量/错误声明；新reviewer逐项验证增量后再讨论代码push。未具备设备与预算的验证明列not_run，并向用户如实说明完整目标仍有哪些未完成，不能靠删范围或改ADR状态达成“全部完成”。
