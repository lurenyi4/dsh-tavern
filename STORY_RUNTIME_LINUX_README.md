> 本次恢复与继续实现状态见 `world-runtime/docs/RECOVERY_AND_COVERAGE.md`。下述历史浏览器阻断仍未解决；新增能力与当前测试数量以当前验证记录为准。

# Story Runtime — Linux 0.1.0

这是在固定 DSH Tavern 源码上增加的**可运行 WorldMode 应用**：本地网页界面、角色卡/素材导入、持久世界、分支、原生交互、有限日程和单一 OpenAI-compatible 模型接口。不是此前的存储原型，也不需要启动原 Tavern 的宽权限工具 profile。

**验证状态：Linux 服务、SQLite、真实 DSH Session/JSONL、HTTP/SSE、导入/恢复与实际前端脚本的 DOM 集成已运行；真实 Chromium 和视觉验收在本执行环境被阻断，尚未通过。** 可运行的真实 Playwright 用户流程脚本随源码提供。Android/macOS/Windows 未验收。

## 快速开始

要求：Linux、Node.js **24.19.0 或更高版本**、npm。首次安装需要访问 npm registry；之后无密钥演示可离线使用。无需全局安装 DSH、Python 或数据库服务。

```bash
npm run install:world-runtime
bash start-story-runtime-linux.sh --data-dir "$HOME/.local/share/story-runtime"
```

首个安装命令用仓库内 `config/cli-runtime/package-lock.json` 安装精确锁定的 DSH `0.1.5-rc.2` 依赖，禁用 lifecycle scripts。启动器不自动安装或下载。打开终端打印的 `http://127.0.0.1:3089`。退出用 Ctrl+C。查看帮助可用 `bash start-story-runtime-linux.sh --help`、`-h` 或 `help`；版本可用 `--version`，这些命令不加载运行时、不安装依赖、不创建用户数据。macOS/Windows 候选入口和未验证范围见 [PLATFORM_MATRIX.md](PLATFORM_MATRIX.md)。

也可以分步执行：

```bash
npm run install:world-runtime
npm run start:world -- --data-dir /absolute/path/to/story-data --port 3089
```

从首页点“打开钟楼镇演示”。这是真数据库/真宿主链路，但回应来自明确标识的确定性样例，不是 AI，不产生 API 费用。演示可输入“前往钟楼”，点击“打个招呼”改变原生变量，并把世界时间推进到 5 查看信使到期行动。作者视图能查看幕后真相；玩家位置认知不会自动与 NPC 世界位置同步。

## 配置真实模型

在**启动服务的终端**设置环境变量，不要把密钥写进卡片、网页、仓库或备份：

```bash
export STORY_OPENAI_BASE_URL='https://your-provider.example/v1'
export STORY_OPENAI_MODEL='your-model-name'
# 如服务需要，在本机设置 STORY_OPENAI_API_KEY；不要发送到聊天或写入源码
./start-story-runtime-linux.sh --data-dir /absolute/path/to/story-data
```

然后在输入框上方主动选择真实模型。远程地址要求 HTTPS；本机模型可用 localhost HTTP。每次发送最多一次模型请求，默认最大输出 1600 tokens，无自动付费重试。可用 `STORY_MAX_OUTPUT_TOKENS` 调整为 128–4096。默认请求 SSE 和 usage；不支持流式的兼容服务可设置 `STORY_OPENAI_STREAM=false`。

程序发送当前分支公开上下文给该模型服务。端点和模型需支持 Chat Completions 与结构化 JSON 正文/变化；模型结果仍经服务器验证。真实付费供应商未在本轮调用或计费实测。未知 usage 显示“未知”，不当作免费；缓存 tokens 仅采用服务实际返回值。稳定前缀和有界上下文不保证服务端命中率。

## 可以做什么

- **导入** ST v1/v2/v3 JSON、带 metadata 的 PNG、常规 Risu CharX，以及有界解码的 legacy v0 module.risum。图片/音频按内容校验并去重；保留原件、未知字段和不支持资源，逐项报告。卡片列表的“报告”可重新查看并下载原件
- **运行故事** 草稿、取消、正式提交状态明确；正式正文、状态、来源和 outbox 在同一 SQLite 事务。投影故障显示待恢复，不重新调用模型或重复世界变化
- **世界面板** 人物、地点、有向多值关系、事实、人物认知、物品、变量、目标、伏笔、日程与调用记录。作者可锁定事实；模型和卡片动作不能覆盖锁定设定
- **分支与修订** 从历史提交开分支，或在作者模式改写某段。旧分支保留，新分支不继承被删去的未来状态；修订失败不会留下半个新分支
- **原生交互** 声明式卡片按钮和作者操作；get/set/increment 变量、有限条件模板。预览无副作用，变化只在正式提交发生
- **有限自主推进** 默认关闭，设置运行时长和事件上限。无到期事项不调用模型；触及玩家动作时暂停。关闭页面不等于暂停，需点“暂停”；重启后默认关闭，不补算长时间缺席
- **备份和导出** 下载带逐文件 SHA256 及卡片/资源引用完整性检查的 JSON bundle；导出玩家可见正文。备份不包含模型凭据或可重建的宿主日志

### 卡片能力与边界

- 原生 `extensions.story_runtime` 可包含安全的初始人物、变量、日程和 `actions`（label/narrative/operations）。示例在 `world-runtime/fixtures/demo-card.json`
- 模板支持变量、条件及最多8层的有界集合循环；card/world/scene变量和生命周期规则由声明式数据实现。有限宽度正则按输入/输出/仅显示阶段运行；复杂语法保留并禁用。详见 `world-runtime/docs/NATIVE_CAPABILITIES.md`
- 世界书使用字面关键词、常驻条目、secondary keys、确定顺序和预算。源插入位置/深度/递归、正则等高级语义保留并报告，不声称与原宿主完全等价
- 任意 JS/Lua、HTML脚本、CSS注入、旧插件 DOM/API、MCP/文件/shell/网络工具不执行。动态插件卸载不是本版能力
- 浏览器上传上限 **20 MiB**；解析器内部 raw 64 MiB、展开 128 MiB、单 entry 32 MiB、512 entries、压缩比 100。ZIP64、加密、symlink、路径穿越、JPEG+ZIP 等不支持容器明确拒绝
- 玩家视图不是完整作者审计视图：隐藏原始操作日志、未埋伏笔、NPC幕后日程；NPC位置只来自玩家明确认知。计划不自动当作已发生事件。公开日程结果只显示明确公开事实

## 恢复备份

先在界面下载 `story-runtime.story-backup.json`。恢复必须选择**不存在的新目录**：

```bash
node world-runtime/cli.mjs restore /path/to/story-runtime.story-backup.json --data-dir /path/to/restored-worlds
node world-runtime/cli.mjs serve --data-dir /path/to/restored-worlds
```

恢复验证清单、SQLite 格式、所有注册卡片及原件/报告/资源/图片引用，再发布新目录。宿主投影回执在该显式恢复中重置为 pending，首次启动从正史重建。日常宿主历史丢失不会被静默当作恢复许可。校验失败不会覆盖旧存档。

同一数据目录只允许一个应用进程。异常退出后的旧锁会在确认进程不存在后清理；若无法确认，程序拒绝启动，而不是抢占。SIGKILL/进程恢复已测，不是硬件断电耐久性保证。

## 开发和验证

应用运行只需上面的锁定 runtime 安装。开发测试的 jsdom/Playwright 来自已有根 `pnpm-lock.yaml`：

```bash
pnpm install --frozen-lockfile --ignore-scripts
npm run test:world
node --test world-runtime/test/e2e-api.mjs world-runtime/test/e2e-dom.mjs
# 在可启动 Chromium 的 Linux 上进行真实浏览器验收：
STORY_CHROMIUM_PATH=/usr/bin/chromium npm run test:world:e2e
```

`test:world:e2e` 不把浏览器启动失败当作 skip/pass。它包含真实页面、文件选择、生成/取消、作者操作、分支、重启、备份恢复和桌面/移动截图；默认使用本机 `/usr/bin/chromium`。DOM 补测执行的是实际 app.js 和真实 HTTP/SSE 后端，只补 dialog/EventSource 的环境缺口，不证明视觉效果。

本轮浏览器阻断：新 Chromium 的 `ProcessSingleton socket()` 被环境拒绝，升级执行权限后相同；受支持 cloud browser 对本地应用地址返回 `ERR_BLOCKED_BY_CLIENT`。没有修改安全设置或换路由绕过，也没有制作假截图。见 `world-runtime/docs/E2E_WORK_LOG.md` 和独立最终审核。

## 架构、许可、已知限制

- 新业务代码：`world-runtime/`。旧 Tavern 源码与模式保留；使用新入口，不运行旧默认 profile
- 世界权威：SQLite `world.sqlite`；原生 DSH Session/JSONL 是带持久身份的可恢复投影。顺序、丢 ACK、重复与 async surface 变化均有回归
- 数据是本地单用户数据；HTTP仅绑定loopback，无远程账户/多人/云同步。任何能访问同一用户本机的进程仍属于本地信任边界
- 规则与结构验证不保证模型叙事合理性。保留作者检查、锁定、分支修订和证据来源；不承诺百万字质量、固定延迟或缓存率
- 真实浏览器视觉验收、真实供应商费用/质量、其他系统平台、安装包签名和外部发布尚未通过。这里未宣称这些已完成

底座固定提交 `403df2d1e4080e4846627a58572c6347e3eefc02`。根 AGPL-3.0 许可和其他来源声明保留；Risu legacy byte map 的来源、固定 commit/blob 和许可在 `world-runtime/src/import-risu.mjs` 与 `docs/IMPORT_WORK_LOG.md`。未向上游推送、发布 Issue/PR/Release，也未使用 Codex CLI 或独立云任务。
