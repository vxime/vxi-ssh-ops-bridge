# Isolated SSH loopback acceptance — V1.1 experiment

This opt-in experimental CI job runs a real OpenSSH client and server on the **same disposable GitHub-hosted Linux runner**. It generates ephemeral client and host ED25519 keypairs, builds `known_hosts` from the generated host public key, runs a fixed health probe using the real `ssh` binary, and repeats the call through the stdio MCP server.

It also rejects a deliberately wrong pinned host key and denied `exec` or `command` MCP arguments. The only permitted remote script is `scripts/remote/vxi-health-check`, which reports script reachability; `service` and `storage` remain `UNKNOWN`.

A shell EXIT trap stops the ephemeral SSH server, deletes its temporary directory and private key files, and removes the demo remote script. The CI runner is ephemeral. The implementation refuses to overwrite a pre-existing `/usr/local/bin/vxi-health-check`.

**Not proven:** real external SSH hosts, user devices, macOS, actual service health, hosted ChatGPT tunnel connectivity, production write/deploy/rollback authority, or resistance to a compromised local runtime. No production host, private project, personal SSH key, or long-lived secret is involved.

Evidence required for acceptance: exact PR head, CI run+attempt, named `ssh-loopback` job success, stdout without secrets, and source SHA. A successful synthetic `npm test` is necessary but not sufficient for declaring this separate integration test passed.
