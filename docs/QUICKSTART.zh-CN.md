# 受控 SSH MCP：快速开始

第一步：`npm test` 与 `npm run demo`。无需 SSH，完全合成。

第二步：在本机复制 `ops.config.example.json` 为 `ops.config.json`，填写只读测试主机。不可提交该配置和真实主机资料。事先独立验证主机指纹并生成 `known_hosts`，使用无特权 SSH 身份。

第三步：在测试主机部署 `scripts/remote/vxi-health-check` 为 `/usr/local/bin/vxi-health-check`，以普通账号只读执行。示例默认只验证脚本可达；业务服务和存储指标保持 UNKNOWN。

第四步：配置中的 `mode` 从 `disabled` 改为 `read_only`，运行：

`node bin/vxi-ops.mjs health --config ./ops.config.json --target lab`

需要网页 ChatGPT 访问时，可另行配置官方 Secure MCP Tunnel，以 stdio 方式启动 `node bin/vxi-ops.mjs mcp`。该连接必须在实际账号和真实测试环境验收，不能因离线通过就认为已经连接成功。

不会开放：任意 shell、sudo、生产部署、重启、日志原文回传、私钥或真实主机信息。部署权限需要另一套独立人工审批的受控能力。
