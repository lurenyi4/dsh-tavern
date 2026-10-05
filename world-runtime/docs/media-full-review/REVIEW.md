# Linux 媒体 / 二进制导入切片：独立全量审核

- 审核对象：`feat/local-media-imports`，`f26cc35b52a43b7217c9085be12f404015b08da6`，父提交 `172a8df`
- 审核日期：2026-10-05；Linux / Node 24.19.0
- 结论：**本切片暂不通过，2 major，1 minor**。171 unit 与 10 HTTP/DOM 测试虽全绿，新增上下游检查确认备份范围不一致和发布后的错误终态
- 独立性：未阅读同时进行的 focused 审核结论；没有修改产品源码、ADR、依赖，没有提交或推送。独立脚本和日志只在本目录。既有 DOM 测试自动重写的三个证据 JSON 已恢复为审核提交内容

## Major M1：有效大卡可以成功导入，但使整个存档不能备份

**位置**：`src/backup.mjs:10,30–36,95–117,125–134`，对照 `src/import-jobs.mjs:115–126`、`public/app.js:360`。

新 UI / job 支持原件至 64 MiB，而备份/恢复单文件上限仍是 40 MiB。普通合成 CharX 含两个各 21 MiB 的未知二进制资源，每个资源在 32 MiB 门内，总原件 44,042,912 字节、展开量也低于 128 MiB。真实 HTTP 上传、worker 解析、预览、接受、原件精确下载和创建世界都成功；随后 `/api/backup` 返回 HTTP 400 `BACKUP_LIMIT: 备份文件超出安全大小限制`。

这是整体备份入口，影响不局限于新卡；用户没有 UI 删除卡或拆分备份路径恢复可备份性。该例整体文件闭包约 84 MiB，低于总量 128 MiB，因此问题明确是单文件门不协调，并非测试人为超出总备份预算。

**证据**：`ordinary-backup-check.mjs` / `.log`。同脚本先做小型图片+WAV卡的真实 HTTP 导入、世界创建、备份和新目录恢复，全部通过；接着普通大卡稳定触发上述结果。脚本最初两次运行因审核脚本选择了不存在的 runtime 路径而未启动，已修为现有 `world-runtime/.runtime` 后执行，产品环境没有安装/改动。

**最小修复**：统一原件在导入、备份与恢复的有界尺寸合同，不仅提高读取端一个常量；明确总闭包预算的行为。加入超过 40 MiB、每 entry 合法、整体闭包低于预算的导入→创建世界→备份→新目录恢复回归。不要丢掉原件或未知资源来让备份通过

## Major M2：原子发布后的存储错误被错误持久化为 failed / cancelled

**位置**：`src/importer.mjs:194–196`，`src/import-jobs.mjs:258–275`，启动恢复 `src/import-jobs.mjs:40–49`。

`rename(staging,target)` 成功后，`registered=true` 只影响 importer 清理；随后 cards 目录同步可能失败。异常传到 accept 时，accept 无条件按 signal 选择 failed 或 cancelled，并写成终态，尽管已注册卡仍存在。启动只对 registering 尝试读卡，因此重新打开不会纠正 failed/cancelled。

**证据**：`publication-fault-check.mjs` / `.log`。实际 worker、JSON原件、注册与磁盘操作均运行，仅对原子发布之后的一次 cards 目录 `sync()` 注入 EIO。无并发取消：返回 failed，真实已注册卡数 1，重开任务仍 failed；同一故障点发起正常 cancel：返回 cancelled，已注册卡数 1，重开任务仍 cancelled。这不是第三方漏洞测试，也没有构造攻击载荷；是持久化故障边界测试。

这与本切片“原子发布后 completed，不虚报 cancelled”的明确合同冲突。用户不能从终态可靠判断是否注册，且重启恢复保持错误说法。

**最小修复**：由 importer 明确向调用者传播已发布事实；accept 在发布后异常时核对已注册卡并返回真实注册结果，同时单独报告 durability/storage warning，不能悄悄把 fsync 失败当已证实持久成功，也不能删除已发布卡或称未注册取消。恢复逻辑应协调记录与实际发布状态。补正常取消、发布后 EIO、EIO+取消和重启四条回归

## Minor m1：预览音频的关闭清理未复用已有素材视图逻辑

**位置**：`public/app.js:366–372,441–455`，对照已有本地素材关闭处理 `179–191`。

注册后素材视图关闭会 pause 并移除 audio src；导入预览只取消 job，没有暂停音频或移除 src。关闭 dialog 不会移除其内容，因此已缓冲音频可能在隐藏的预览中继续播放。预览也没有注册后素材视图的解码失败提示。

**证据等级**：静态确认没有生命周期清理；没有真实浏览器音频播放实测，不将实际持续播放声称为已观察事实。

**最小修复**：抽一个很小的媒体节点创建/释放 helper，供已注册素材与预览共用；关闭/取消/完成替换前暂停并释放 src，复用 error 提示；不需要另建媒体框架。增加关闭预览的清理断言及有条件的真实浏览器音频测试

## Spec 轴：覆盖及未覆盖

| 要求 | 审核结果 |
|---|---|
| 原计划 §13.1 预览与接受边界 | binary→worker→ready 不注册；显式 accept 才注册；JSON/PNG/CharX 正常流程通过 |
| §13.2 图片/背景/表情/常用音频资源 | 按所有已验证本地 assets 渲染，不只首张封面；图片 lazy，audio controls/preload none；真实 PNG/WAV HTTP 字节回归通过 |
| 精确原件与未知资源 | 21 MiB 既有真实分块测试通过；新增 42 MiB HTTP 测试精确原件下载通过；小型卡完整 backup/restore 通过；大卡闭包被 M1 阻断 |
| §13.5 / T-09 进度与取消 | XHR 是实际字节进度，解析阶段无虚构百分比；上传中断、预览关闭、解析取消、发布前资源清理及进程 SIGKILL 既有测试通过 |
| 错误与重启恢复 | 未注册 staging 与 orphan media 清理、既有引用保留通过；M2 暴露发布后的真实磁盘错误边界不完整 |
| CAP-08 媒体边界 | 没有自动请求远端；预览按 job asset 集合、正式素材按哈希及安全 sniff；浏览器 CSP/nosniff 保留 |
| 原计划完整产品 | 不宣称 Android、真实广泛 ST/Risu 样本、真实 Chromium解码/视觉、HTML/CSS交互等效、四端或真实模型成本已完成 |

## Standards 轴与真实上下游

- 读取 AGENTS、原始计划 §13.1–13.5 / CAP-08、切片说明、CONTRACTS；审查新增源码完整变更及 importer/format/resource gates、UI事件、server路由/生命周期、worker、job日志、store/world创建、backup/restore与现有调用方
- KISS：沿用既有 importer 和单一注册入口、现有卡资源模型、原子目录发布、既有 server 独占目录锁，没有新增世界状态权威。worker 模块很小；媒体节点重复逻辑是可局部改进处
- 有界资源：64 MiB 原件、128 MiB 展开、32 MiB entry、512 entry、worker 30秒均存在；解析输出仍在内存中并经 worker clone，不误称恒定内存/手机认证
- 数据一致：正常重复导入保持内容哈希身份，accept completed 可读已存卡；注册前取消清理新 links，保留早先共享 media；发布后异常是本次主要缺口
- HTTP与旧兼容：旧 `/api/import` base64 入口及其原限制保留，正常导入/世界/故事/分支/知识/隐私/DSH投影/备份回归通过；新增逻辑没有写世界 canonical state
- 安全边界仅作防御性静态检查和既有普通回归：路径、hash、只读/显示白名单、外部引用不下载、后台脚本不执行、主机/origin与CSP保留；没有第三方扫描或利用探测
- 许可、用户私有数据、public自动部署设置没有被本次源码改动改写；本审核没有触发发布

## 独立运行证据

- `unit.log`：`node --test world-runtime/test/*.test.mjs`，171/171，通过；包含21MiB实际chunk上传、实际子进程SIGKILL恢复
- `dom.log`：实际 app.js + jsdom + HTTP/SSE/SQLite/固定 DSH runtime，7/7，通过；不是 Chromium，也不是视觉/设备解码证明
- `http-api.log`：真实本地 HTTP + SQLite + DSH 集成，3/3，通过，包含故事提交、取消、分支、隐私、备份和恢复
- `ordinary-backup-check.log`：独立普通小/大卡上下游检查，确认 M1
- `publication-fault-check.log`：独立发布后目录sync失败及取消时序检查，确认 M2
- `source-sha256.txt`：审核源码哈希。结束时 tracked diff 为零；只有两组独立审核目录未跟踪

本结论只针对冻结切片。M1/M2修复后应针对新SHA双轴复核；当前全绿回归不能替代这两条失败路径，也不能推导完整产品已完成。
