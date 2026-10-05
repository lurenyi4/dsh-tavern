# 媒体 / 导入候选：独立全量审核

日期：2026-10-05 UTC。审核 SHA：`080b9dd1dd0b930fcfc9e6cec3cd76761cb3bdb0`，分支 `feat/local-media-imports`。全量范围：`172a8df057cf2f716a867fa4f70fed3b2f400fd7..080b9dd`，包含最初媒体切片与其修复，**不是只复核旧报告的聚焦替代**。

## 结论

**FAIL / Changes required：1 Major、2 Minor。** 175 unit 和 10 HTTP/DOM 全绿；旧大原件备份、发布后 fsync、预览媒体释放修复已得到独立验证。但普通输入仍可被接受后同时无法创建世界、无法整体备份；两条普通存储失败生命周期尚不闭合。

本审核只读源码，独立脚本/日志均在本目录；未修改产品源码、staged 内容、ADR、依赖、分支，不提交、不推送，不通过 Codex CLI 或新云任务执行。阅读旧两份 FAIL 以了解声明修复的对象，但新结论来自完整变更阅读、独立运行与新增上下游检查。没有使用另一名当前审核员的结果。

## M1 — Major：规范化数据的复杂度未纳入准入，已接受卡会阻断备份且不能开世界

位置：`src/importer.mjs:249–269`，尤其265行仅检查规范化JSON字节数；`src/import-formats.mjs:4,8–20`；`src/backup.mjs:44,57`；`src/domain-state.mjs:63–100,763–771`；`src/server.mjs:577–605`。

独立普通合成资料卡：5000条世界书，每项仅 id、keys、content、comment、enabled、insertion_order，无脚本、远端引用或异常输入。原件636,763字节、40,005 JSON节点，均在现有准入合同内。规范化保留 raw 等数据后变为1,762,956字节、105,029节点。

真实HTTP结果：binary upload 202 → worker ready → accept completed → 原件字节一致；创建世界400 `INVALID_INPUT: JSON input is too complex`；整体备份400 `BACKUP_CLOSURE: card.json 格式不受支持（IMPORT_LIMIT）`。未产生可供恢复的备份。现有JSON/原件/文件数/总量门均未阻止此卡注册。

证据：`ordinary-metadata-closure.mjs` / `.log`。测试保留失败断言，未改成接受失败的绿色测试。此前4500/5000条仅3字段的普通控制输入能成功备份，添加合法常用字段后出现上述结构预算不一致。

归因：世界书规范化和下游复杂度门早于此候选存在，**不把它误称为080b9dd新引入的回归**。但本切片新增预览/接受以及“可接受闭包在备份预算内”的共同准入修复，仍未满足其端到端不变量；不能以只修复旧42/60MiB例子即判定该合同完整。

影响：卡已正式登记，即使不创建世界，整个目录备份也失败；不能靠缩小下一次上传或取消已完成job恢复。不要删除未知字段、raw或资源来静默使它过门。

最小修复方向：在预览前和注册锁内使用共同的规范化内容合同，覆盖备份可读性与正式世界可消费性。对不能运行但选择保留的内容，必须明确说明并建立仍可完整备份的保留路径；不能给出普通可用成功。字节、深度、节点、单字符串、数组及世界卡字节上限都应一致处理，而不是只添加“5000条”特判。若调整下游门，仍需明确有限预算与兼容既有数据。增加多种合法结构的准入→世界→备份→新目录恢复检查。

### 入口 / 消费者预算矩阵（共同策略需要覆盖）

| 位置 | 当前门 | 审核说明 |
|---|---|---|
| UI `public/app.js:371`附近 / jobs `158–163` | 64MiB原件 | UI只检查文件大小；job检查整数、非空与64MiB |
| legacy `server.mjs:85`附近、`556–572` | 32MiB HTTP JSON body；20MiB base64 decoded目标 | 旧入口仍到共同importCard；旧上限未擅自抬高 |
| importer `165–183` | 1..64MiB原件；注册前检查预算 | preview/legacy/restore重建都需同一内容合同；重复卡复用已登记记录 |
| formats `4,8–20` | JSON 8MiB、depth64、100000 nodes | 检查的是源JSON；规范化可能增加节点与层级 |
| formats `4,52–105`附近 / risu `14–23` | 128MiB展开、32MiB entry、512 entry；压缩比100、路径深12/512bytes；模块同类门 | 源格式有界，不等于规范化下游有界 |
| importer `42–45`、`sourceData` | 世界书≤5000、assets≤512、tags/greetings≤1000 | 5000条合法条目不保证总节点下游可读 |
| new `checkImportBudget:265–269` | 规范化card/report≤8MiB；每文件64MiB、总128MiB、2000文件；DB+WAL保守计数 | **缺失规范化深度/节点/字符串/世界5MiB门** |
| `readCard:203–214` / `safeRead:149–154` | 32MiB读取界；JSON.parse及身份检查 | 可以读出下游拒绝的复杂card，故HTTP GET/accept不说明可使用 |
| domain-state `63–100,763–771` | depth32、100000 nodes、单字符串1MiB、数组20000；卡5MiB、name512 | 与import/backup深度和byte合同不同；真实世界创建命中节点门 |
| backup `10,30–41,95–140` | 每文件64MiB、总128MiB、2000文件、card roster≤666；restore编码JSON≤192MiB | 整体byte/file修复有效；还要考虑闭包元数据解析 |
| backup `44,57,62` | card/report复用源parseJson（8MiB/depth64/100k）；原件重建比对；世界引用比对 | 真实backup命中规范化节点门；restore同样无法验证这样的闭包 |
| jobs `227–239` | worker30秒 | 是解析worker时间限；不宣称恒定内存或移动设备内存认证 |

## m1 — Minor：终态job淘汰会丢失上传文件的清理责任

位置：`src/import-jobs.mjs:176–180`，对照启动`36–74`及`cleanup:78–88`。

普通ready预览取消时，向该upload的第一次`fs.rm`注入一次EIO，真实磁盘文件保留，返回cancelled + cleanupWarning。随后故障解除，执行50个普通create/cancel，使旧job依照保留政策淘汰。淘汰只删除`.json`与Map条目，未重试清理`.upload`。close不再知道旧job；startup只扫描有`.json`的job。因此重启后仍保留该44字节上传原件，且无记录可供用户取消重试。

证据：`storage-fault-lifecycle.mjs` / `.log`，输出 `recordRetained:false, uploadAfterRestart:true`。用小型无害原件验证文件生命周期，不声称观察到64MiB文件；同一清理路径允许更大文件，重复故障可留下持续占用。

修复方向：清理未完成的记录不能按普通history淘汰；或淘汰时保留明确清理责任，并在独占目录启动下安全扫描所属孤立upload/tmp。持久化记录的保留上限与临时文件的生存期要分开。补“清理失败→故障解除→记录轮换→关闭/重启”测试。

## m2 — Minor：上传接收阶段的清理失败覆盖主存储错误，并保留 uploading 假状态

位置：`src/import-jobs.mjs:279–287`。

向普通上传文件`sync()`注入EIO，同时仅向其随后第一次`rm()`注入EBUSY。真实接收/写文件执行，只有这两个存储调用失败。`receive` catch先close/rm，再设failed；rm抛出使后半段永不执行。观察：调用返回EBUSY，job仍为uploading，error与cleanupWarning均为空。原EIO丢失。故障解除后显式cancel能恢复slot并清理文件，无已注册数据损失，因此定Minor。

证据：`upload-storage-fault.mjs` / `.log`。这与修复声明“primary persistence errors retained、cleanup为单独warning”在worker-ready路径上的实现不同；上传路径遗漏统一终结逻辑。

修复方向：先确定/保留主错误和真实终态；close/rm各自收集次要清理错误，复用cleanup重试逻辑。不要让一次清理异常阻止记录主错误。补sync/write/close失败与cleanup失败组合，以及取消/重启后的可恢复性。

## 已验证的修复与完整切片覆盖

- 旧40MiB单文件门已对齐64MiB。独立真实HTTP小PNG/WAV及44,042,912字节CharX均通过上传、worker预览、accept、原件下载、世界创建、backup、新目录restore、原件及未知资源逐字节一致、恢复目录重新启动及world列表验证。见`large-backup-restore.mjs` / `.log`。
- 该脚本从旧独立脚本迁移时，首次仍保留“large应失败”的旧断言而报TypeError；这个**审核脚本错误**记录于`large-backup-initial-obsolete-assertion.log`，不是产品失败。最终脚本改为要求大卡backup/restore成功并扩展恢复核验，未改产品。
- 独立post-rename目录fsync EIO，分别无取消/同时取消：均completed + IMPORT_DURABILITY/storageCode EIO，真实已登记卡一张；close/reopen仍completed并保留warning。见`publication-fault-check.mjs` / `.log`。没有将此视为已证明硬件断电耐久。
- 175 unit独立全量运行通过。包括binary 21MiB实际分块、worker解析、preview无注册、精确unknown资源、取消、部分上传、实际子进程SIGKILL、恢复及已登记共享资源保留、超总闭包的普通PCM媒体拒绝、ready记录EIO+cleanup重试、发布警告及丢失协调、旧格式与backup closure。
- 10 HTTP/DOM独立运行通过。包括实际app.js事件、JSON/PNG/CharX显式accept、关闭预览、图片/WAV精确HTTP字节、媒体error反馈与pause/remove-src/load生命周期断言；旧API、SQLite/world/branch/故事/SSE/隐私/DSH投影及backup。DOM仅复制当前测试改变import/runtime/evidence路径，避免改写候选的已有证据。
- 规范入口仍按preview/accept分离；XHR使用实际上传字节，解析无伪百分比；本地图片lazy/audio preload none，所有媒体共享renderer与释放helper，未知原件资源不丢弃，不自动拉取远端；legacy base64仍保留。
- 原子目录rename仍是注册边界；发布前新asset links清理，发布后不能谎称取消；服务器现有数据目录锁保持；worker并未另建世界状态权威。
- 完整源码检查涵盖此次全部生产改动（app/styles/server/import-jobs/worker/importer/formats/backup/storage-limits）、旧调用方、资源读取、世界消费、恢复、UI事件和媒体生命周期。安全只作防御性静态检查与普通既有回归，没有第三方目标、扫描或利用测试。

## Spec、Standards / KISS与边界

阅读AGENTS、原计划完整§13.1–13.5、CAP-08、T-09、当前MEDIA_IMPORT_SLICE与CONTRACTS，并对照历史两份FAIL及修复声明。范围内媒体浏览/预览接受/原件保存/二进制进度/取消/重启大体匹配；M1阻断“接受后真实可用和可恢复”闭环，m1/m2阻断完整失败清理合同。

KISS正向：共享mediaFigure/releaseMedia、现有importer和存储模型、很小worker入口、共同文件预算常量，未新建框架或第二份canonical world。仍需把准入/消费结构校验和失败终结策略收拢，避免不同入口各补一个特例。

本审核没有运行真实Chromium可视/键盘/可听解码测试，未测试Android原生/content URI/峰值内存、Windows/macOS、合法广泛真实ST/Risu生态样本、完整HTML/CSS互动等效或真实模型质量/成本。合成fixtures只是格式/IO证据，Linux bounded clone/in-memory解析不等于Android认证。这些完整产品门仍开放，不能以此切片或测试数宣称全产品完成。

## 执行与源码完整性

- `node --test world-runtime/test/*.test.mjs`：175/175，通过；`unit.log`
- `node --test world-runtime/docs/media-candidate-full-review/existing-dom-isolated.mjs world-runtime/test/e2e-api.mjs`：10/10，通过；`http-dom.log`
- `node .../large-backup-restore.mjs`：通过；完整新目录恢复与重开
- `node .../publication-fault-check.mjs`：通过；两种发布后EIO时序
- `node .../ordinary-metadata-closure.mjs`：失败，M1
- `node .../storage-fault-lifecycle.mjs`：失败，m1
- `node .../upload-storage-fault.mjs`：失败，m2

以上均Node v24.19.0、Linux隔离临时目录。全部脚本自行清理临时测试数据。末次tracked diff为空，只有本独立审核目录未跟踪；候选HEAD未变化。源码hash见`source-sha256.txt`。
