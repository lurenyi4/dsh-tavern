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
