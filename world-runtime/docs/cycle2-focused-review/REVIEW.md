# 第二轮独立聚焦审核

- 日期：2026-10-05 UTC
- 冻结基线：`12b0f306cde8a200ff7e200aa125419639c40bcc`；父提交 `91ae6c9322f7ef66be4200590234ff073be80faf`
- 结论：**旧问题已有实质修复，但本轮仍发现 1 项 Major，不能关闭完整目标/发布验收门。** 未发现新 Critical；未新增独立 Minor
- 未改产品源码、ADR、许可证，未提交、推送、调用付费模型、Codex CLI或独立云任务。全部剧情、模型响应、数据库为本地合成数据，无第三方目标或攻击测试

## 已读输入与证据边界

已读根 AGENTS.md、上一轮 `world-runtime/docs/independent-focused-review/REVIEW.md`、外部 `dsh-full-review-20261005/FULL_REVIEW.md`、本轮 `WORK_LOG.md`、`CONTRACTS.md` v2、`CURRENT_VALIDATION.json`，并追读 actor-view/model/domain-state/behavior/store/server/knowledge/UI 的相关实现。本审聚焦旧 major/minor 闭合，不冒充另组完整需求审核。

独立执行：

- 相关8测试文件（review-fixes、schema-migration、actor-domain、behavior、model、knowledge、store-recovery、backup-closure）：103/103 pass，0 skip，日志 `focused-tests.log`
- 实际 HTTP/DOM：9/9 pass，0 skip，日志 `http-dom-tests.log`。这是真实app脚本与本地HTTP，不是 Chromium视觉验收
- 独立实体/迁移组合测试：6/6 pass，日志 `ids-migration-independent.log`，代码 `ids-migration-independent.test.mjs`。另外15项既有review/schema测试有重复验证，不与103重复累计
- 独立正常语义组合：`semantic-positive-probes.mjs/.log`，覆盖actor/world位置和变量条件、结束后重建关系、通知重开、首幕召回和错误旧checkpoint撤回
- 独立失败探针：`functional-probes.mjs/.log` 与真实本地HTTP `relation-http-probe.mjs/.log`，确认下述 C2-F01

既有DOM测试会自动重写仓内 `docs/e2e-evidence/dom-report.json`、`release-ui-regressions-r02.json`、`release-ui-regressions-r04.json`，已向父任务报告由其协调其他审核组结束后恢复冻结证据；不是产品修改。未修改两份旧独审报告。

## C2-F01 · Major · 暂存关系的ID跨模型到提交仍不稳定，合法关系终止请求结算失败

位置（相对 world-runtime）：

- `src/domain-state.mjs:439–453`：每次 add_relation 新建仍直接 `randomUUID()`
- `src/model.mjs:264–278`：新修复的关系投影向模型提供实际暂存 relation.id 与生命周期字段
- `src/server.mjs:250–279,333–359`：input/before_generate暂存后的状态进模型，输出操作再与原始规则操作拼接提交
- `src/store.mjs:589–618,649–657`：持久预留及最终重放只处理 entityIds，没有关系ID绑定

正常合成故事：卡片input规则为甲乙建立“同伴”关系；玩家说两人结束同行。模型从本轮公开状态读取宿主提供的关系ID，并生成 `end_relation` 引用该ID。暂存验证成功，但最终commit重放add_relation时生成新关系ID，后续end_relation报 `UNKNOWN_REFERENCE: Relation is not in the current branch`。

证据：

1. `functional-probes.log`：offeredToModel=true；保存结构化草稿→关闭store→重开→commit仍失败，canonicalRelations=0
2. `relation-http-probe.log`：真实本地兼容模型收到relation.id；1次请求后SSE返回 draft 与 UNKNOWN_REFERENCE，场景=0、关系=0。不是伪造外部ID，也不是模型猜测ID

影响：F02补齐模型ID后，正常“规则新建关系→模型修改/终止”路径仍无法结算；实体F01修复不能泛化为全部宿主对象身份稳定。现有15项新回归没有覆盖这条组合。原子回滚有效，未观察到半写数据，但用户无法提交合法正文；保存草稿重试不能自行修复不同ID。

最小修复：把宿主规范化/持久预留扩展到会进入暂存上下文并允许后续按ID引用的关系（建议统一对象创建身份机制）；每次重放按同一操作标识复用同一ID，保持模型不能自行指定任意新ID。不要隐藏已经支持的关系操作来规避问题。补input和before_generate创建→model update/end→成功提交、失败重试/重开、结束后重建与去重不额外消耗ID测试。

## 旧项逐项闭合判断

### F01 实体hostID：实体范围已闭合

既有真实HTTP回归通过；独立HTTP多阶段input/pre/model/output四次create_entity分别使用预留[0..3]。注入提交after-state失败，canon保持不变；关闭服务器重开后结算重试保留全部ID且无额外模型调用；后续生成取消后canon不变，重开仍不可重试。外部create_entity不能携带id的严格字段合同保持。**关系身份另见 C2-F01，不把实体通过写成全对象通过。**

### F02 / M2 关系生命周期投影：旧丢字段问题已闭合，组合身份问题另开

模型、知识包、搜索保留id/status/validFrom/validUntil/双向称呼/来源，ended不再成为未标状态当前关系。独立“建立→结束→相同类型重建”得到两个不同ID和正确active/ended。历史关系在同一列表明确标状态，此合同可以接受；不要求必须从全部历史列表删除ended。暂存关系ID问题不否定旧字段丢失已经修复。

### F03 认知条件：已闭合本轮合同

普通位置/变量默认actor投影；显式author world模式才查全局合法性。独立同一NPC位置误认及他人私有变量四个日程：actor两项取消，world两项执行；普通非author操作设置world模式被AUTHOR_REQUIRED拒绝。到期仍用canon验证真正的操作合法性。没有将此证据扩大为NPC自然规划/付费模型质量验收。

### F05 / M3 锁失效卡队列：已闭合

独立重跑覆盖实体、关系、变量LOCKED_FIELD取消及合法同行事项继续，取消原因持久；解锁后新安排可执行。源码仅捕获列明的领域失效，不把数据库/程序错误统一吞掉。

### M1 作者audit / publicNarrative / card description：本轮正常流程已闭合

author标记和独立publicNarrative同事务保存，legacy作者场景缺audience默认隐藏；player card.description来自actor-filtered主角。既有修复测试及实际DOM测试覆盖切视角、正文、上下文、搜索、知识、导出、重开。未将这类正向功能验证描述成全面安全认证；当前本地单用户author/player模式本来也不是远程鉴权系统。

### F04 持久检查点：机制缺口已闭合，效果验收仍open

真实SQLite metadata保存world/branch/actor/sourceVersion/visibilityVersion/coveredCommitIds/summaryVersion/epoch/text/createdAt；重开完整记录不变。85场景首幕按查询召回；独立试验把旧player checkpoint送到撤回分支/NPC上下文，编译器拒绝不匹配epoch，未混入被撤回或NPC未见的首幕。源设定和权限变更有失效测试。

当前仍是每20场景抽取最近块、有界词匹配召回（最多4条），不是语义摘要、无界长期记忆或真实自然度证明。此前F04的“完全无持久记录且首幕无召回路径”已修；大世界检索质量、伏笔自然延续、缓存收益等原门继续开放。

### F06 持久post_commit：本轮合同已闭合

通知在统一#commit事务计算并持久，涵盖生成、author、card-action、schedule、time及revision调用；幂等命中直接返回已有提交，不重跑通知。player只显示可见场景对应通知，规则读取仍经actorState。真实HTTP断后重连返回保存notice、无额外模型请求；独立author/schedule组合重开后所有历史notice保持。不可将通知等同正文/所有副作用执行平台。

### v1→v2 迁移：本轮相邻格式路径已闭合

独立测试覆盖活跃WAL数据进入VACUUM一致备份；备份两个v1版本标记，当前两个v2标记；目录fsync失败保留原库v1数据与两个标记；事务失败回滚；未知索引schema/不一致标记在生成迁移备份前拒绝。既有未知未来版本拒绝通过。逻辑v2让旧v1程序版本守卫拒绝新库，避免忽略audience元数据。迁移样本是同布局数据库降级为v1标记后写入合成数据，不是从历史发布安装采集的真实存档；不是Windows目录flush或真实硬件断电认证。

## 不可削减的仍开放门

本轮合同和CURRENT_VALIDATION如实保留以下状态。本次不删除、降格或用Linux正例替代：

- Android新WorldMode原生APK/content URI/storage桥未实现
- macOS/Windows未实机验收；Windows目录fsync未验证
- Chromium真实页面、移动布局、视觉截图仍环境阻断，DOM通过不等价
- 全媒体资源体验、代表性许可卡玩法、导入进度/取消和大媒体移动内存仍open
- 真实模型自然度、长期召回质量、供应商缓存/费用A/B尚无预算/实测
- 远程CI工作流仅新增，不能说已经远程通过；完整发布仍由用户授权及全部验收门决定

## 建议下一步

修复C2-F01并新增真实HTTP回归，再冻结新SHA交独立复核。其余旧修复保持，不回退到禁止暂存创建/禁止关系更新等削减功能的做法。继续原平台/视觉/媒体/质量门；当前可以称尚未完整验收的Linux开发候选，不能称附件目标全部完成。
