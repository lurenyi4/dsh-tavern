# 媒体导入修复：新独立聚焦审核

日期：2026-10-05 UTC。冻结对象：`080b9dd1dd0b930fcfc9e6cec3cd76761cb3bdb0`，`feat/local-media-imports`，父 `f26cc35b52a43b7217c9085be12f404015b08da6`。

## 结论

**PASS（本次 Linux 媒体导入修复切片）：Spec 轴无 Major，KISS/质量轴无 Major。** 原先两项 Major 已通过实际存储/HTTP链路复核。另记录一个不阻断的 Minor：重启纠正旧失败记录后仍保留陈旧 error 字段。此结论不等于整个产品通过，不覆盖 Android 原生、真实浏览器视觉/解码或广泛社区兼容。

## 已关闭旧问题与证据

1. **42/60 MiB 原件备份闭包：通过。** `src/storage-limits.mjs:2–7`统一64 MiB原件/备份成员、128 MiB总量和2000成员；`src/backup.mjs:10–11,95–117,125–134`读取与恢复共用；`src/importer.mjs:181,249–269`在注册锁内核算原件、去重资源、媒体、元信息、已有卡和数据库/WAL；`src/import-jobs.mjs:242–245`在ready前再次核算。
   - 本次重新运行真实HTTP测试：44,042,912字节普通CharX → worker → preview → accept → 原件HTTP逐字节一致 → 创建world (201) → backup (200) → 新目录restore，全部资源逐字节一致。日志 `focused.log`。
   - 原独立60 MiB脚本仅改模块路径，未改断言，重新运行通过：62,917,268字节，两个30 MiB unknown资源和音频，preview时无注册；接受后原件/unknown资源/备份恢复精确一致。日志 `prior-independent.log`，脚本 `prior-independent.mjs`。
   - 现有普通PCM资源重复闭包超128 MiB回归重新通过，ready前明确拒绝且旧卡保留（`test/import-jobs.test.mjs:283–321`）。不是放宽到无界，也不是抛弃unknown资源。
2. **发布后fsync EIO及取消终态：通过。** `src/importer.mjs:196–199`把成功rename作为发布事实，后续sync失败单独返回 `IMPORT_DURABILITY` 和底层EIO；`src/import-jobs.mjs:314–315`记录completed，`38–72`重启对照实际卡。
   - 独立新写 `http-eio.mjs`：真实HTTP上传/worker/存储/接受，唯一故障点为cards目录发布后的sync抛EIO；无取消和并发HTTP取消均completed，告警保留EIO，原件HTTP一致，服务器关闭/重新启动仍completed+warning。
   - 同脚本把记录变为旧版本failed/cancelled+registering并重启，真实注册卡均纠正为completed+不确定持久性warning。日志 `http-eio.log`。
   - 现有 `media-publication.test.mjs`重新通过：还包括在确切sync时刻直接cancel、旧记录协调，以及模拟目录缺失时 `IMPORT_PUBLICATION_MISSING`。这是单点存储错误注入，其余路径真实；不冒充物理断电实验。
3. **失败上传清理：通过。** `src/import-jobs.mjs:78–92,253–262,328–376`提供独立cleanup告警和终态cancel/close重试。原独立ready保存失败脚本现 `.upload`清空；新增ready保存EIO+清理EIO回归重新通过，主错误保留，cancel重试清理，重开仍failed/EIO。
4. **预览媒体信息/解码错误/释放：通过（DOM证据）。** `public/app.js:67–114,193–203,452–459,480,1617`以同一小helper呈现名称、MIME、KiB和一次性error反馈；close/replacement/accept/unload执行pause/remove-src/load。隔离路径运行实际 `app.js` 的媒体HTTP/jsdom用例通过，覆盖实际WAV响应、预览接受/取消、关闭和替换、一次error提示与音频释放调用。脚本 `dom.mjs`，日志 `dom.log`。jsdom媒体方法只作生命周期调用计数，不能证明真实声音或解码。

## 新非阻断 Minor：重启纠正后残留旧 error

位置：`src/import-jobs.mjs:47–56`（转completed未删除saved.error），`122–127`（直接暴露error）。独立HTTP日志两个分支均显示：纠正后的status为completed，warning正确，但error仍为旧EIO。用户可根据status正确判断注册；当前UI以status为主，未发现丢卡/误取消或持久性虚假声明，因此不升Major。

建议在纠正时将旧error转为明确的历史诊断字段或清除，并保留warning中的不确定性；增加旧记录带error的断言。当前实现的错误字段语义略有歧义。

## Spec与质量双轴

已读原计划§13.1–13.5、CAP-08与T-09、当前切片说明、旧两份FAIL以及CURRENT_VALIDATION；静态审核修复diff和importer/backup/job/worker/UI相邻控制流。

- Spec：二进制XHR真实上传字节进度；解析阶段不伪造百分比；worker解析、30秒上限；显式ready→accept；取消、重新选择、重启中断恢复；全部已验证本地图片/音频浏览；原件/unknown资源保留与闭包备份，均有代码和本次重跑证据
- 质量/KISS：共享常量修复合同偏差、一个容量核算函数复用两处、小型媒体创建/释放helper，没有新增第二套世界状态或媒体框架；注册锁、原子目录rename和内容寻址沿用既有架构
- 当前容量检查是保守当前占用，WAL与DB相加可能早拒绝；后续世界数据库增长仍可耗尽有限备份预算，已明确披露。没有据此承诺无限可备份性
- 解析包仍有有界内存复制和worker structured clone。60 MiB脚本观察RSS约502 MB仅是该Linux进程时点，不是峰值认证或移动端证明
- 本次不是安全漏洞复现/第三方探测；只有普通合成内容、HTTP正常交互、可控本地存储故障及已有防御回归

## 本次运行清单

- `node --test world-runtime/test/import-jobs.test.mjs world-runtime/test/importer.test.mjs world-runtime/test/backup-closure.test.mjs world-runtime/test/media-backup.test.mjs world-runtime/test/media-publication.test.mjs`：63 passed，0 failed（`focused.log`）
- `node --test media-repair-focused-20261005/prior-independent.mjs`：5 passed，0 failed（`prior-independent.log`）
- `node --test --test-name-pattern='media import previews' media-repair-focused-20261005/dom.mjs`：1 passed，0 failed（`dom.log`）
- `node media-repair-focused-20261005/http-eio.mjs`：exit 0，两个发布EIO/重启分支通过（`http-eio.log`）

不把既报175 unit/10 HTTP-DOM绿灯冒充本人的全量重跑。未跑真实Chromium；不关闭Android native/content-URI/设备内存、Windows/macOS、licensed真实ST/Risu生态、HTML/CSS交互等效或真实模型质量/成本门禁。

## 修改范围

此审核仅在仓库外 `media-repair-focused-20261005` 写脚本/日志/报告，无产品源代码、ADR、stage、branch、commit或push变化。结束时tracked diff为空；另一个并行审核的 `world-runtime/docs/media-candidate-full-review/` 未跟踪目录未触碰。
