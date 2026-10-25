# VXI SSH Ops Bridge

A small **read-only, named-operation SSH bridge** for local or tunnel-backed MCP clients. Node.js 22+, zero third-party npm dependencies. The default mode is **disabled** and there is no generic `exec(command)` tool. The local administrator, not a cloud model, binds an abstract alias to a verified SSH host and a fixed remote script.

## Offline demo

```bash
node --version  # >= 22
npm test
npm run demo
node bin/vxi-ops.mjs policy
```

The offline demo needs no SSH host, credentials, or network access. It proves only that the command contracts and sanitization functions work with synthetic data.

## Production-independent read-only setup

1. Create `ops.config.json` from `ops.config.example.json` on your own machine. Keep this file out of Git.
2. Configure a dedicated unprivileged SSH account on a **non-production** host, its locally stored private key, and a **separately verified** pinned `known_hosts` file. Never adopt the first observed SSH host key without checking its fingerprint through an independent channel.
3. Copy `scripts/remote/vxi-health-check` onto that test host as `/usr/local/bin/vxi-health-check` with appropriate ownership and read/execute permissions. Its default result proves only that the script ran; `service` and `storage` remain UNKNOWN until you implement and validate application-specific checks.
4. Edit local `ops.config.json`: set mode to `read_only`, replace the synthetic host and absolute paths. All target values are local configuration; only a fixed generic alias (`lab`, `sandbox`, or `staging`) is returned by the MCP server. Production aliases are rejected.
5. Execute the one fixed local check:

```bash
node bin/vxi-ops.mjs health --config ./ops.config.json --target lab
```

Do not mount personal `~/.ssh/config` as the privilege source: the SSH call intentionally ignores it (`-F /dev/null`), disables password/agent prompts and forwarding, and enforces explicit known-host pinning.

## Run MCP stdio (optional)

```bash
VXI_OPS_CONFIG=/absolute/local/path/ops.config.json node bin/vxi-ops.mjs mcp
```

Available tools: `vxi_ops_policy` and `vxi_ssh_health`. `vxi_ssh_health` accepts **only** `{ "target": "lab" }` with a locally allowlisted alias. It cannot execute model-generated shell text or accept arbitrary host parameters. Errors and stderr are replaced by generic status; successful stdout is parsed to a strict three-enum schema.

For ChatGPT integration, the official **OpenAI Secure MCP Tunnel** supports a local stdio server and avoids publicly exposing a local port. Set the tunnel client's `--mcp-command` to this local MCP command, after creating your own tunnel and authentication using:

https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

**No live SSH or ChatGPT tunnel test has been performed for this package.** The tool is a read-only baseline, not a production deployment gateway. Never run as root or reuse credentials from a production deployment agent.

## Hard limitations

- The demonstration remote script returns `PASS` for *script reachability*, not application health. `service` and `storage` remain UNKNOWN.
- No deployment, write, restart, arbitrary logs, SFTP, sudo or firewall operations exist in the MCP interface.
- Strict known-host pinning is required. Before use, verify the remote host fingerprint out of band.
- A hostile remote host may provide malformed output; the bridge rejects extra fields, overly long output and unrecognized statuses.
- DNS, host compromise, local malware, SSH implementation vulnerabilities and local credential theft remain outside this narrow threat model.
- A future staging deployment path must be a **separate local-only tool** with exact artifact digest, explicit human approval, independent identity and rollback evidence. It must not be added to the read-only cloud MCP interface.

License: MIT.