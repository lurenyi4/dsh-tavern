# 第三轮独立聚焦审核

日期：2026-10-05 UTC。冻结源码：`172a8df057cf2f716a867fa4f70fed3b2f400fd7`；父版本 `12b0f306cde8a200ff7e200aa125419639c40bcc`。

## 结论

**本轮聚焦的两项 Major 已闭合：C2-F01 / S2-01 的跨阶段记录身份，以及 S2-02 的到期事件有效时间。未确认新的 Critical、Major 或 Minor。** 结论仅覆盖下列已审代码和正常合成剧情证据，不是完整需求、四端或发布验收。

未改产品源码、ADR、许可证或既有测试；未提交、推送、创建独立云任务或使用 Codex CLI。所有数据库、角色、剧情、模型响应均为本地合成数据；无真实供应商请求、无第三方目标测试。只新增本目录的审核报告/探针/日志。

## 输入与方法

已读 cycle2-focused-review 与 cycle2-full-review 原报告及日志，查阅本轮 WORK_LOG、CURRENT_VALIDATION、CONTRACTS，并读 cycle2 原 relation-http-probe.mjs 和 normal-flow-probes.mjs。检查本次 diff 及 server / behavior / domain-state / run-identity / store / model 相关执行路径。未先读取本轮另一全量审核组结论。

独立执行结果：

- 9个相关既有测试文件：110/110 pass，0 fail/skip。包含本次 run-identity-time 七项、旧 entity-only 草稿兼容、作者文字/关系投影/迁移/恢复等相邻回归。见 `focused-tests.log.txt`
- 独立扩展真实 HTTP 测试：1/1 pass。见 `independent-http.test.mjs` 与 `.log.txt`。复用既有 HTTP fixture 结构，但增加跨 input/pre 的事实、玩家日程和目标，以及对应合法 ID 更新/取消断言
- 独立时间组合测试：1/1 pass。见 `independent-time.test.mjs` 与 `.log.txt`
- cycle2 原真实 HTTP 探针：保留同一剧情和请求流程，仅调整导入路径及断言为预期修复结果，退出0。见 `original-http-green-probe.mjs`、`original-http-green.log.txt`
- 核对六个核心源文件 SHA256；见 `source-sha256.txt`。审核结束产品源码 diff 为空

本组没有跑 DOM、Chromium 或全部163单测；不将 maker 的163单测/9 HTTP+DOM计为自己的独立覆盖。110项与另一组可能重复，不能相加为独特用例数。

## C2-F01 / S2-01：闭合

代码证据：

- `store.mjs` 的 `reserveRunIdentity` 为已接收的 world/branch/run 持久保存一个宿主 UUID namespace，重复读取复用
- `server.mjs` 为 input → before_generate → generated.operations → model_output 共享同一个 operationCursor，再保存同顺序的扁平操作提案
- `domain-state.mjs` 每条操作推进位置，创建时按位置和 family 派生 ID；实体/关系/事实/目标/伏笔/日程/资料主记录与资料修订均接入。去重保留旧记录且不会让后续位置漂移
- `#commit` 从持久元数据读取同一 namespace 重放；旧 entity-reservations 仍被兼容读取。外部 create_entity 没有增加允许指定任意ID的字段

实际 HTTP 证据不仅断言“ID非空”：

1. input 新建并去重“信物”事实、新建玩家等船日程和玩家归还信物目标
2. before_generate 新建并去重同伴关系，另建同行目标/伏笔
3. 本地兼容模型从服务实际发送的公开上下文读取关系、事实、两个目标、伏笔、玩家日程的ID
4. 模型按这些原ID修改事实、完成目标、更新并结束关系、更新伏笔、取消日程；另重建同类型关系
5. 首次写入注入 after-state 故障，确认到达该故障且没有 UNKNOWN_REFERENCE；关系未半写
6. 关闭服务器并重开，通过 HTTP settlement-only retry 成功。全部被提供的记录ID仍相等；关系 ended 和新 active 分离；事实已归还、日程 cancelled、两个目标 achieved；模型请求仍1次、只提交1场景

旧探针的 input 建关系→模型 end_relation 直接路径也以真实 HTTP 成功，原关系ID保持且状态 ended。既有专项测试另覆盖保存草稿重开、幂等重复、取消后不可结算、非玩家日程不可进入玩家上下文，以及旧实体预留格式。

**边界**：正常生成的持久 run 是此保证入口。手工独立调用 runBehaviors 不传 namespace 再向另一个 run 提交，不具有同一身份上下文；cycle2 全量旧脚本的裸调用不可直接作为修复后标准生产链路。对已保存的扁平操作重排不是受支持的原样结算重试。资料属于 author-only，不能把“统一分配器支持资料”夸大为模型可以改作者资料。

## S2-02：闭合

`advance()` 在读取当前事件后先计算 `max(state.time,current.at)`，将计算状态时间更新后再做认知前置条件与领域校验。`#commit(..., effectiveTime)` 对同一权威事务中的提交状态同样先设时间再 applyOperations；事件状态转换随后进行。外层 advance 的事务覆盖这一批事件，未插入提前独立发布的时钟提交。

独立组合证据：

- 两个 at=10 事件、at=15 关系锁取消、at=20 观察，目标推进25
- maxEvents=1 的首次调用只推进到10，不提前跳到25
- 第二调用在第二次 after-state 写入注入故障；整个快照与调用前逐字段相等，重开数据库后仍相等
- 再推进后同事 validUntil=10、新朋友 validFrom=10；三条观察 knownSince=10/10/20
- 后加的关系锁让15时事件 cancelled、原因 LOCKED_FIELD；同事件观察不写入，锁定关系保持 active，20时合法事件继续
- 从取消事件 fork 得 time=15 且尚无20时观察；分支推进22后观察仍记录20；原分支保持25

既有本次专项套件另独立重跑并通过恢复的 overdue 队列（当前20、到期10→validFrom/knownSince均20）、全批失败回滚、重开、10时fork与取消等用例。Overdue测试通过直接修改本地合成SQLite fixture模拟恢复状态，不是声称常规UI自然产生了该状态。

初版独立探针把关系在安排日程前就锁定，按合同被安排时校验拒绝；这是探针前置条件错误，非产品回归。已改为先合法安排再上锁，红色日志单独保留为 `harness-initial-invalid-plan.log.txt`，不冒充产品先红后绿证据。

## 相邻回归与剩余风险

110项相关回归保留：旧entity-only草稿重开/幂等、作者audit与publicNarrative分离、legacy作者文字保守隐藏、关系生命周期投影、actor认知前置条件、锁取消、迁移与备份、持久checkpoint与post_commit等。未发现本次身份/时间修改使这些既有断言回退；这不是未执行的所有交互组合或安全认证。

合同前部仍以旧“Run entity reservations”描述身份，末尾 Cycle3 clarification 已明确新 namespace 和兼容路径；可顺手将前段标成 legacy 以减少阅读歧义，属编辑建议，不构成已确认运行缺陷。本审核未修改合同。

## 不可替代的开放验收门

- Android新WorldMode原生APK/content URI/storage桥未实现
- macOS/Windows未实机验收；Windows目录flush尚未验证
- 真实Chromium页面/移动布局/视觉截图仍未验收；DOM不等于视觉通过
- 广泛许可卡生态、完整资源媒体体验、大导入取消与移动内存仍open
- 真实模型自然度、长期召回、真实供应商缓存与费用A/B仍需预算和实测
- 远程CI与正式四端发布不由本次本地专项结果代替

结论允许关闭两项本轮明确修复的正常流程缺陷；不能宣称完整附件目标或正式发布门通过。并行期间观察到三份 e2e-evidence JSON 被其他任务重写，本组未运行对应DOM测试、未回滚其他任务产物；交父任务协调。
