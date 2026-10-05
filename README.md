# Story Runtime / DSH Tavern fork

在 DSH Tavern 固定源码基础上恢复并继续实现的本地故事运行器。上游版权、AGPL-3.0 与逐项第三方许可保留。本仓库目标为非商业化使用；不额外修改上游开源许可证。

## 当前入口

要求 Node.js 24.19.0 或更新版本。首次安装需要 npm registry。

```sh
npm run install:world-runtime
npm run start:world -- --data-dir /absolute/path/to/new-story-data
```

浏览器打开终端打印的 loopback 地址。无密钥演示是明确标识的确定性样例；接入真实模型见 [运行说明](STORY_RUNTIME_LINUX_README.md)。密钥只在本地服务环境变量中配置，不写仓库、网页或存档。

- [本次恢复、需求覆盖与未完成验收](world-runtime/docs/RECOVERY_AND_COVERAGE.md)
- [新增原生能力](world-runtime/docs/NATIVE_CAPABILITIES.md)
- [上游原说明](README_UPSTREAM.md)

## 不要混淆入口

根目录旧 `install.sh` / `install.ps1` 与旧 launcher 是保留的上游 Tavern 代码，仍指向上游发行体系，不是本 fork 的 Story Runtime 安装入口。请使用本页 npm 命令或 `start-story-runtime-linux.sh`。没有创建新 Release、发布网站或向上游写入。

原自动 Pages / runtime manifest 发布工作流已改为手动触发，首次推送不会发布站点或回写版本清单。不要未经核对便执行上游安装/升级说明。

## 验证边界

Linux 世界库、真实 DSH Session/JSONL、HTTP/SSE 与实际应用脚本 DOM 流程有自动测试。当前云环境无法启动 Chromium（socket 权限限制）；真实浏览器E2E和截图仍未通过。macOS、Windows、Android没有实际运行验收，不用移动视口代替手机。真实供应商费用、自然度与缓存效果尚未评估，未发生付费测试。

完整跨平台目标尚未验收完成，详见覆盖表。不能把源码恢复或单测通过当作四端正式发布。
