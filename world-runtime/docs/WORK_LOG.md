# Linux产品执行记录 · 2026-10-04 UTC

## 范围调整
用户在研究/原型交付后明确要求完成成品、先把Linux端跑通。因此本轮继续已有DSH Tavern checkout，接受Linux驱动/投影事实，增加真实WorldMode界面与服务。其他三端实测转后续，未修改成“只交CLI原型”。目标、接口与接受决定见LINUX_SCOPE、CONTRACTS和ADR-LINUX。

## 实现与根因

- 新世界入口独占SQLite字段；旧Tavern原模式不改。正文/变化/outbox原子提交，真实DSH Session+JSONL仅投影，避免旧前台先提交造成双权威
- 持久run分开记录草稿、生成、失败、取消和中断；相同scope/run的固定载荷不可改，取消不晚提交，显式结算重试不再请求模型
- 分支完整继承只到提交点，revision用单事务fork-before-target+replacement，失败不留半个分支
- ST/PNG/CharX/module导入保留原件并逐项报告，安全资产不可变；原生模板与JSON动作不执行原卡脚本
- UI全部从实际HTTP获取数据，SSE草稿与提交明确；身份/权限仍是本地单用户界限，无远端账户与shell工具

## 测试先行与独立检查

各模块工作日志保存了缺实现/缺API时真实红灯和修复后绿灯。没有把module-not-found红灯包装成生产bug定位。

首轮独立后端审核发现：B01原始操作日志泄漏私有更新/嵌套计划；B02未埋伏笔进入玩家上下文；B03失败的真实模型草稿重放被隐藏；B04恢复允许遗漏资源引用；B05缺branchId默认为active。另Q01预算直接截断JSON。

落实修复：玩家不接收原始operations，NPC位置来源于player belief，计划/幕后日程不自动公开；draft统一只存可识别叙事文本；备份从原件重新推导注册卡/资源闭包；所有world POST强制branch；模型状态按结构分项预算。均保留回归红/绿证据，失败审核原文保留。

补充DOM集成实际发现模型select的HTML闭合错误，修复后真实app.js+HTTP流程通过。没有用静态语法检查替代交互测试。

## 实际命令与结果

- `node world-runtime/install.mjs`：exit0，使用精确上游npm lock，全新.runtime安装524包、禁用lifecycle scripts、核心版本rc2核验
- `npm run test:world`：exit0，103/103，0 failed，0 skipped；包括导入、核心、模型/SSE、恢复闭包与HTTP端到端
- `node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs`：exit0，6/6，0 skipped。API3组与DOM3组；真实HTTP/SSE、SQLite、DSH，无付费模型
- `node --check world-runtime/test/e2e-browser.mjs`：exit0；只代表脚本语法，不代表浏览器执行
- 上游官方runner聚焦story-ledger、story-timeline、session-stable-prefix、host-projection-replay-native：34/34，0 skipped；真实DSH_BOOT_MODULE指向已安装rc2
- `node bin/build-tavern-client.mjs --check`：exit0；原上游client产物未修改
- 独立最终全量审核在FINAL_RELEASE_REVIEW_AFTER_FIX.md，以实际报告结论为准，不能由本日志代替

## 浏览器阻断与验收界限

Chromium进程在启动阶段因ProcessSingleton socket权限失败，经获批升级执行后仍失败；已有受支持cloud browser拒绝localhost，ERR_BLOCKED_BY_CLIENT。已经核实无适用预览/端口转发入口。未更改安全设置、换URL/外部服务绕过、创建独立任务，未制作假截图。

因此真实Chromium、移动布局与视觉截图门尚未通过；Playwright全流程脚本交给可运行浏览器的Linux验证。DOM补测执行实际app.js/真实后端，只补dialog/EventSource环境，不能代替浏览器。

真实付费供应商、硬件断电、其他平台均未测。所有故事测试为合成数据。原型遗留问题曾经修复，不意味着自动证明本实现；本轮对新实现重新测试/审核。

## 复杂度说明

增加应用模块、静态界面和测试用于真实用户闭环，不创建微服务、另一个Harness或多协议网关。源码增加主要来自强校验/故障恢复/格式导入与测试。复用实际DSH宿主原语及卡片字段projector，保留其来源许可。不为了负增长删除验证；没有复制整套上游前端另改。

## Linux完整候选审核后的必修修复
第一轮完整候选审发现R01真实流式进程崩溃未保存已显示草稿；R02刷新未重接活跃运行；R03同key异holder日程泄漏；R04作者/玩家快速切换竞态；R05所选开场未进入模型上下文。另修正测试runtime默认路径、Chromium环境变量名。该FAIL报告保留。

修复后：每个可见流式片段先同步写draft checkpoint再SSE；真实子服务mid-stream SIGKILL后重启保留原文，attempt标本地中断/用量未知且不再调用模型。新DOM重接原运行，视图切换强制新请求并清空私密面板；延迟真实响应回归通过。日程只广播明确public且精确身份匹配事实。默认/替代开场同样的纯模板预览进入真实本地兼容服务请求，保留非正史导入素材地位。

最终103项应用测试与6项API/DOM测试通过。真实浏览器仍blocked，未变更其结论。最后的全新独立审查与打包SHA校验另记录。

## Help 入口收尾
用户要求关闭Q04。只调整新建WorldMode CLI与Linux launcher，help/--help/-h在安装、runtime导入、状态路径和监听前返回。无runtime的隔离复制入口回归覆盖10种调用并禁止listen，检查没有数据目录或runtime安装。先红后绿；完整快速测试104/104，API/实际app DOM 6/6。源码冻结交全新独审；旧报告保留。

## 2026-10-05 恢复与新增（本次日志，不继承历史通过状态）
Library原Linux包恢复；本轮重新安装锁定runtime及开发依赖，未执行来源附件脚本。原git历史未打包，本地新建main；原SHA只是归档provenance。

按先红后绿补knowledge、behavior、actor-domain、observability、reference、platform回归；初始缺模块/新断言失败日志在current-validation，不能伪称所有红灯都是旧生产bug。新增代码用于已缺功能和故障边界，没有新增服务、任意脚本执行或第二套Harness。

修复开发中实际发现：新normalizer必须保留v1备份重建语义且不静默启用旧卡规则；规则append/condition也须actor过滤；CLI跨平台文案变化导致crash test旧启动匹配失效，更新匹配并再次真实SIGKILL验证；场景变量只暂存，不持久写入；完整关系列表保留结束历史。

严格保留未通过：Chromium两次启动（含一次获批提升）socket失败；无截图。Android原生桥缺、Windows/macOS未测、真实供应商未调用。GitHub仅按最终授权仓库发布；继承自动Pages/manifest已手动化；原版权保留。实际冻结测试/哈希在当前验证文件，旧FINAL报告只说明历史。

## 2026-10-05 第二轮：合并聚焦/全量独审后修复

基线91ae6c9322f7ef66be4200590234ff073be80faf的两组报告均保留，未改成通过。先写review-fixes/schema-migration及相关失败断言，再实现并回归：

- F01：run元数据持久预留host实体ID；input→model引用→最终commit→草稿重开/幂等复用同一ID，外部操作仍不能填写任意ID
- F02/M2：模型/知识/搜索保留关系ID、active/ended、有效期、称呼和来源；晚出场实体/相关关系优先进入预算
- F03：普通位置/变量决策默认actor知识；明确作者world模式才可读世界合法性真相。到期再验证实际状态，不把认知等同现实
- F05/M3：实体/关系/变量锁定使该日程带原因取消，其他合法日程继续；解锁后新安排可执行，不吞存储错误
- M1：作者audit正文与明确publicNarrative分离，同事务audience；统一裁剪玩家DOM/模型/检索/章节/知识/TXT，旧作者场景默认隐藏；描述遵守actor投影，切回玩家清空作者dialog
- F04：SQLite实际保存带来源/可见性/摘要版本/覆盖ID的checkpoint；早期可见来源按本轮查询召回，85场景、重启与fork撤回有回归。不是额外模型摘要或真实缓存收益证明
- F06：所有commit路径存一次只读notice，SSE重连返回同一保存结果，不重新执行规则
- 为使旧程序拒绝忽略audience的新数据，逻辑存档升级v2；valid v1先VACUUM INTO一致备份并flush，再事务更新版本。失败flush保留v1；未知未来格式不迁移。未声称硬件断电或Windows目录flush已验收
- minor：新增只读Linux新核心CI；旧安装器/站点提示上游归属；知识Markdown转义；资料提供作者独享选项；合同统一v2；额外模型参数白名单/工具禁用声明

对实际改动模块使用固定官方Prettier3.6.2格式化。行数增加主要是展开原一行式代码便于审查，不是新增框架或运行依赖。原ADR、LICENSE、来源声明不改。格式化后再跑真实回归；新测试记录见当前验证文件。

仍未关闭原目标：Android原生桥、Win/mac实机、真实Chromium、全资源媒体体验/大导入取消与移动内存、真实模型质量费用。没有以scope改写消掉这些门，没有push/Issue/Release/Pages。

## 2026-10-05 第三轮：cycle2独立审查后的两项Major

cycle2两份原报告/各自执行日志保留在cycle2-focused-review与cycle2-full-review，不改原结论。并行DOM审核改写的三份e2e-evidence JSON未被git restore；本轮重跑生成最新证据，前轮独立日志保留。

S2-01先以真实本地HTTP复现before_generate建关系→模型读取合法ID→update/end→保存失败草稿→重开结算仍UNKNOWN_REFERENCE。修复不是关系专用计数：宿主持久化一个run UUID命名空间，按保存的扁平operation位置派生UUIDv5；所有会新建的实体/关系/事实/目标/伏笔/日程/资料主ID与来源修订统一使用此机制。去重不分配新记录，后续操作位置不因去重分配次数改变；外部操作仍不能指定新对象ID。旧entity-only预留只保留兼容读取，不用于新生成。实际HTTP注入after-state事务失败后，重开仅重试结算成功且模型请求仍1次；多记录族、取消、关系结束再建立均有回归。

S2-02先测出due=10关系/认知时态却为0。现在每个到期事件先取effectiveTime=max(当前世界时间,dueAt)，在同一advance事务的计算状态和commit写状态中先设时刻，再校验/应用delta。没有提前发布独立时钟commit。覆盖10/15锁取消/20多事件、25结束时刻、reopen、10时fork、恢复的overdue队列及第二事件写入失败整体回滚。

新增run-identity小函数和一项持久namespace，不建通用框架/每类分配表。原ADR、许可与完整目标未改。Android原生/Winmac/Chromium、大媒体/生态/真实模型质量门仍open；没有push。

## Linux media/import continuation — 2026-10-05

Kept source172a8df/publication58562fac fixed and created feat/local-media-imports. Addressed the confirmed cover-only and immediate/base64 import gaps with local image/audio gallery, binary upload progress, worker parsing, preview acceptance, cancellation and recovery. No third-party media, external service calls, new packages, Android installation or remote writes are part of this slice. Details and remaining acceptance boundaries: MEDIA_IMPORT_SLICE.md. Initial new import-job tests failed because the implementation did not exist; then genuine filesystem/process/HTTP/DOM tests ran against the implementation. Ordinary development syntax/test-harness corrections are not claimed as product bug evidence. New independent reviews are pending.

## Media review repair — 2026-10-05

Read both first media reviews, preserved their FAIL evidence, and reproduced M1/MF-01 as normal 42 MiB HTTP backup rejection and M2 as registered-card EIO returning failed. Unified finite import/backup/restore limits and added aggregate closure admission at preview and locked registration. Published cards now return a separate durability warning; restart reconciles existing/missing publication. Added retryable upload cleanup and a shared media creation/release helper with decoder feedback. 60 MiB original reviewer scenario passes unchanged. No remote write, dependency install, ADR or original permission change; prior public main remains58562fac. Final validation and hashes are in CURRENT_VALIDATION.json; fresh independent rechecks are required.

## Normalized-content / lifecycle review repair — 2026-10-05

Read both080b9dd reviews. Reproduced all three full-review findings as RED with ordinary local content/storage errors:5000-entry card failed world/backup; expired job lost upload cleanup; receive EIO was replaced by cleanup EBUSY and remained uploading. Added one shared normalized-card policy across importer, read, world and backup/restore, retaining raw source/unknown values and a finite expansion budget. Added exact boundaries, pre-ready rejection, three actual HTTP closed-loop structures and write/sync/close plus cleanup combinations. Cleanup responsibility now survives eviction and old completed records clear stale error. No remote pushes, source deletions, new dependencies or ADR changes. Details: NORMALIZED_CONTENT_CONTRACT.md; final counts/hashes in CURRENT_VALIDATION.json; new independent reviews pending.

## Worker failure ownership — 2026-10-05

Both091ee8f independent reviews identified the same adjacent worker-completion error overwrite. The new real HTTP probe first reproduced INVALID_JSON being replaced by cleanup EBUSY. Reused one small failJob method for receive and worker completion: preserve the first primary error, finalize unregistered failure, release prepared data, then best-effort close/cleanup and journal save with separate warnings. No admission limits, canonical world behavior or storage architecture changed. The HTTP probe is green; new transient/persistent cleanup and journal-failure combinations verify INVALID_JSON through retry and server-data reopen. Original reviews are retained in media-091-focused-review and media-091-full-review. New independent approvals remain required before publication.
