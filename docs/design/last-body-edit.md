# 最后一轮正文编辑

入口：游玩对话底部“更多 → 编辑正文”。仅允许编辑最后一轮非开场正文；生成、后台处理或重生成期间不可保存。

- `<dream_body>`、`<content>`、`<gametxt>` 等叙事协议标签保留原字节，其包裹的文本可编辑；这些标签不按 HTML 容器处理。
- 文本段提供编辑框；原始 HTML 与 HTML 围栏完整保留，不进入编辑框。纯 HTML 回复不可编辑。
- 保存不调用模型、不重新结算、不重放宏或脚本；已有状态、MVU 变量、剧本游标保持不变。旧候选项清空。
- Chat 通过 Story Timeline 的 `body.edit` 意图保存新正文及修订。读取时的版本凭据防止覆盖其他窗口的新正文；展示采样不构成正文冲突。
- 原生 Session 追加合成 assistant replacement，只替换当前正文的 Surface 节点。旧 Event Log 不变。编辑使用独立合成来源，不复用旧模型回复的 reasoning/replay 信息。
- Chat 保存的 `bodyEdit` 记录持有原生事件位置和稳定消息 ID。保存、后续请求前进行幂等同步，恢复 Chat 已落盘而 Session 未落盘的中断。
- 编辑后的正文强制提供展示投影，避免 DSH 历史展示仍渲染旧文本；重生成新正文时清除旧编辑同步标记。

验证：`body-editor.test.mjs` 覆盖分段保真、冲突、状态保留及写入恢复；`body-editor-native.test.mjs` 覆盖存档恢复后的真实 Agent 请求；`fixtures/body-editor-browser-smoke.mjs` 使用正式前端组件与原生 Session 提供独立浏览器验证页面。
