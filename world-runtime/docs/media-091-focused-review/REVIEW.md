# 规范化合同修复：独立聚焦审核

日期：2026-10-05 UTC。冻结 SHA `091ee8fc052fc53b0c08e5efb3c2b9552d34a312`，父 `080b9dd1dd0b930fcfc9e6cec3cd76761cb3bdb0`，分支 `feat/local-media-imports`。

## 结论

**PASS with one non-blocking Minor（仅此 Linux 修复切片）**。Spec 轴未发现 Major；质量/KISS 轴未发现 Major。旧规范化复杂度 Major、两项存储失败 Minor 及旧 completed/error 歧义均已闭合。本次新增观察到一个相邻旧路径的诊断 Minor，见下文。不是整产品发布认证。

## 旧问题独立 RED → GREEN

通过 `git archive HEAD^` 将父版本源文件导出到仓库外隔离目录，旧独立三个 probe 分别在父版本与候选运行。模块路径改为对应绝对路径；生命周期probe的stat改为缺失时0（否则修复成功会导致诊断stat自身ENOENT）；upload probe允许terminal cancel保持failed，保留主错误断言。产品代码未修改。

- **规范化105029节点**：父版本 ordinary probe 真实HTTP ready→completed后world400、backup400；候选同一636763字节/40005源节点输入，规范化1762956字节/105029节点，world201、backup200。`red-ordinary-metadata-closure.log` / `green-ordinary-metadata-closure.log`。
- **清理责任淘汰**：父版本取消一次rm EIO后50轮普通create/cancel，record被淘汰、重启仍残留upload，断言RED；候选无残留，GREEN。`red-storage-fault-lifecycle.log` / `green-storage-fault-lifecycle.log`。
- **上传主错误保留**：父版本sync EIO + rm EBUSY返回EBUSY、status uploading、无主error/warning，RED；候选返回EIO、status failed、error EIO与cleanupWarning EBUSY分离，GREEN。对应upload-storage-fault日志。

## 合同与实现检查

阅读 NORMALIZED_CONTENT_CONTRACT、MEDIA_IMPORT_SLICE、旧full/focused报告、AGENTS，以及生产diff和相邻调用方。

- `src/storage-limits.mjs:12–19`设定有限的5MiB/32depth/250000nodes/1MiB字符串/20000数组/name512共同常量；没有5000条特判。
- `src/domain-state.mjs:68–112,769起`让initialState使用同一预算；普通jsonValue默认100k预算保留。原native世界初始化约束仍然运行。
- `src/importer.mjs:145–146,252–254`在转换结束和注册预算检查内运行initialState及report检查；`175–184`注册锁下复查；`209,277–280`stored read复用parseCardMetadata；`src/backup.mjs:44`把card元数据走同一parseCardMetadata。源格式8MiB/depth64/100k没有被混同为规范化保证。
- metadata节点250k只是有限空间预算，不保证每个合法源都能装下；真正超限输出提前拒绝，原字段不通过删减来过门。源original/media预算保持64/128MiB策略不变。
- `src/import-jobs.mjs:179–201`淘汰前重试清理、失败保留责任并限制50条；`291–315`先记录主错误再best-effort close/cleanup；启动通过cleanup清掉已解决warning；`49–53`纠正completed时清旧error、持久性warning保留。
- KISS：小型共享常量和既有initialState复用，没有另造一套卡校验器、世界状态或归档成功模式。initialState额外构建暂态state有一定重复工作，但在明确有界输入下未构成Major。

## 本次运行及独立新增检查

1. 12/12聚焦回归通过：content-contract、ordinary-metadata-closure、storage-fault-lifecycle、upload-error-combinations、upload-storage-fault、media-publication；`focused.log`。
   - 包括恰250000/+1节点、恰5MiB/+1字节、深度/字符串/数组/name边界，共同world/read检查
   - 正常5000条、深层future、Unicode+10000项数组：真实HTTP→preview→accept→world→backup→新目录restore→server reopen，原件逐字节保留
   - module raw+mapped扩张超过预算提前拒绝，既有卡不污染
   - write/sync/close + cleanup失败，cancel/restart，旧completed/error与publication warning修复
2. 新独立 `independent-transitions.mjs` / `.log`：探测未知root字段经迁移包装后的准确深度转换，源嵌套28通过、29在ready前拒绝；native初始角色重复player在ready前拒绝；原unknown future与custom值deepEqual、原件逐字节、已有keeper卡仍在；partial upload + EBUSY保留IMPORT_INCOMPLETE，cancel及重启清除upload/warning，主错不丢。
3. `import-jobs.test.mjs`另10/10通过（`jobs.log`）：分块21MiB、显式accept、取消、部分上传、SIGKILL后preview恢复、发布前共享资源保留、ready保存EIO+cleanup重试、超闭包拒绝。合计本人22个聚焦测试通过。
4. 三个旧独立probe父RED/候选GREEN，见上。

以上是本人实际运行；maker的186 unit/10 HTTP-DOM仅背景，不冒充本人全量重跑。

## 新非阻断 Minor：worker解析失败路径仍会让清理错误覆盖解析错误

位置：`src/import-jobs.mjs:260–269`。

独立 `parser-cleanup-error.mjs` 用8字节未完成JSON正文（完整传输8字节）进入实际worker解析，同时仅把其首次upload rm注入一次EBUSY。worker的INVALID_JSON本已写入j.error，但263行直接rm抛错，269行把它覆盖为EBUSY；随后cleanup重试成功。最终status failed，error EBUSY，无cleanupWarning，解析失败原因丢失。`parser-cleanup-error.log`保存结果。

影响仅诊断：不注册、不损坏既有卡、临时文件已清理、slot可继续使用，故Minor不阻断本次PASS。此相邻路径在父版本已存在，不把它称为新回归。建议失败worker分支也使用同一cleanup helper，保留message.error；增加INVALID_JSON+瞬时/持续cleanup失败组合断言。

## 保留门禁及完整性

未验APK、Android原生/content-URI/设备内存、Windows/macOS、真浏览器视觉/音频解码、代表性授权社区卡、HTML/CSS等效、真实模型质量/成本。DOM及合成fixture不替代这些门禁。更早main `58562fac…` CI绿不是本候选已发布证明；未推送或宣称候选发布。

全部新增probe/日志/报告在仓库外 `normalized-focused-review-20261005`；未修改产品源码、staged内容、ADR、分支或commit，无Codex CLI、新云任务或push。结束时git status与cached diff均空。父源导出初次缺tavern-plugin依赖仅属审核搭建问题，补导出父版本该依赖后重新运行，RED均为预期业务断言失败。
