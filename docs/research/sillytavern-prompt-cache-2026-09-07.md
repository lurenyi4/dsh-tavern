# SillyTavern 上下文缓存与工具调用核查

核查日期：2026-09-07。官方 release 分支固定到 `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`，package.json 标注 1.18.0。本地 tools/SillyTavern 有用户修改，本次未改动，结论采用另行下载的官方固定版本源码。未调用付费模型、未取得用户账单或实际请求 usage，因此没有测得可代表酒馆用户的命中率。

## 结论

“每轮动态组装完整上下文，所以缓存利用率必然低”不成立。客户端重建数组与模型服务端复用前缀是两回事。只要最终发出的稳定前缀保持相同，满足模型阈值、落盘、TTL、缓存设置等条件，完整重发也可以高命中。

“酒馆没有考虑缓存”不成立：存在专门的缓存配置及实现。“只能一次模型调用，不能主动工具调用后继续生成”也不符合当前版本源码。

更准确的判断是：酒馆支持缓存，但灵活的世界书、宏、预设和历史裁剪可能改变前缀；具体命中率取决于实际请求与供应商，不能把架构名称当实测结果。DSH/Agent 也适用同样标准。

## 官方实现

- [默认配置](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/default/config.yaml#L350-L370)：Claude 的 enableSystemPromptCache、cachingAtDepth、extendedTTL；此版本默认分别 false、-1、false。配置注释专门提醒：聊天历史之前出现随机宏或动态世界书可能造成缓存未命中。默认关闭显式 Claude 缓存不意味着所有厂商缓存都关闭。
- [Claude 缓存标记](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/backends/chat-completions.js#L255-L309)：可给系统提示词、工具及历史消息添加 cache_control。
- [历史断点实现](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/prompt-converters.js#L981-L1060)：按角色切换深度放置断点，跳过 assistant prefill；OpenRouter 路径还跳过 system。不能把 cachingAtDepth 简单解释成界面的“第几条消息”，也不能把某个数字推荐成所有预设通用最优值。
- [提示词管理文档](https://docs.sillytavern.app/usage/prompts/prompt-manager/)：允许调整前后位置、角色和聊天深度。靠后的动态注入只影响附近尾部，不必摧毁前方全部缓存。
- [世界书文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)：激活条目可随聊天内容动态变化。只有具体的内容或位置变化，才可推断对前缀的影响，不能把“用了世界书”一概视作低命中。

## 何时可能高，何时容易降低

| 场景 | 对缓存的影响推断 |
| --- | --- |
| 固定人物卡与规则，旧历史不变，只在末尾新增对话 | 稳定前缀可复用，连续聊天可以高命中 |
| 动态状态/作者注仅插入靠近末尾的位置 | 前方仍可复用；插入点后的内容不一定可复用 |
| 动态世界书、随机宏、状态栏被放在靠前位置 | 较早发生差异，会影响后续大片前缀复用 |
| 窗口满后删掉历史开头、更新前置摘要 | 历史部分前缀改变，可能明显降低命中；更前面的固定规则仍可能命中 |
| TTL 到期、缓存未落盘、模型/路由切换、未满足最小长度 | 即使文字相同，也不保证实际命中 |

举例仅用于说明，不是测试数据：2 万输入 tokens 中有 1.8 万来自已缓存稳定前缀，输入命中比例可达 90%；若较早的动态内容使有效可用前缀只剩 2 千，则可复用比例约 10%。实际以服务商 usage 为准，不能把共同前缀长度直接当作实测命中量。

## 厂商规则与统计口径

[DeepSeek 现行缓存指南](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)：缓存默认开启，但必须完整匹配已落盘的前缀单元；构建需要时间，缓存是尽力而为。A+B 后再发送 A+B+C 可以复用既有前缀。相同逻辑内容但角色、顺序或较早文本变动，不等于相同前缀。

DeepSeek 输入 token 命中率：`sum(prompt_cache_hit_tokens) / sum(prompt_cache_hit_tokens + prompt_cache_miss_tokens)`。

[Claude 官方规则](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)：按 tools → system → messages 前缀缓存，可设置自动或显式断点；TTL 默认 5 分钟，也可选 1 小时，最小长度随模型变化。

Claude 输入 token 命中率：`sum(cache_read_input_tokens) / sum(cache_read_input_tokens + cache_creation_input_tokens + input_tokens)`。不能只拿 input_tokens 当全部输入；缓存写入不是缓存读取命中。缓存写入/读取价格、输出费用不同，输入命中率也不等于总费用节省率。

若要比较两套产品，应固定供应商、模型、预设、人物卡、对话与时间间隔，读取最终请求和原始 usage，按 token 加权统计。分别报告首轮、连续聊天、世界书变化和历史截断阶段。仅凭“请求带 cache_control”“界面显示使用缓存”或“我省了很多钱”都不足以量化整体命中率。

## 工具调用观点纠正

[官方 Function Calling 文档](https://docs.sillytavern.app/for-contributors/function-calling/)列出联网查询、记忆检索、RAG 等扩展能力；需使用支持的 Chat Completion 来源和模型，并开启 function calling。存在默认 5 轮的工具递归上限。quiet、continue 等部分生成类型不允许发起调用。

[实际执行链](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L5350-L5377)为模型请求工具、执行工具、保存结果、递增 depth、再次 Generate。非流式路径也有相同流程。因此不能再用“完全不能自主第二次模型调用”区分酒馆和 Agent。这里不据工具支持推断它具备某个特定 Skill 标准或完整后台 Agent 生命周期。

## 建议对外表述

SillyTavern 支持提示词缓存，也支持工具调用。它的动态上下文组织允许预设、世界书和状态改变较早的提示词，因此某些配置会损伤前缀缓存；稳定前缀、尾部追加的配置同样可以高命中。更值得比较的是默认配置能否持续保持前缀稳定，以及实际 usage 中的命中比例，而不是是否重新组装请求。
