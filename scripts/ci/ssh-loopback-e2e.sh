#!/usr/bin/env bash
# Real OpenSSH loopback integration test for an ephemeral GitHub-hosted runner.
# This script must never be pointed at a real external host.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo 'CI fixture must be launched by the unprivileged runner user.' >&2
  exit 2
fi
if [[ ! -x /usr/sbin/sshd ]] || ! command -v ssh-keygen >/dev/null || ! command -v ssh >/dev/null; then
  echo 'OpenSSH client/server tools are required.' >&2
  exit 2
fi
if [[ -e /usr/local/bin/vxi-health-check ]]; then
  echo 'Refusing to overwrite an existing remote probe on this runner.' >&2
  exit 2
fi

port=22489
user="$(id -un)"
tmp="$(mktemp -d)"
chmod 700 "$tmp"
server_pid=''
installed=0
cleanup() {
  if [[ -n "$server_pid" ]]; then
    sudo kill "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$installed" -eq 1 ]]; then
    sudo rm -f /usr/local/bin/vxi-health-check
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N '' -f "$tmp/host"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
cp "$tmp/client.pub" "$tmp/authorized_keys"
chmod 600 "$tmp/authorized_keys"
# Known-host binding is derived from the host key we generated ourselves.
printf '[127.0.0.1]:%s %s\n' "$port" "$(cat "$tmp/host.pub")" > "$tmp/known_hosts"
chmod 600 "$tmp/known_hosts"

cat > "$tmp/sshd_config" <<CFG
Port $port
ListenAddress 127.0.0.1
HostKey $tmp/host
PidFile $tmp/sshd.pid
AuthorizedKeysFile $tmp/authorized_keys
AllowUsers $user
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
PermitTTY no
AllowAgentForwarding no
AllowTcpForwarding no
X11Forwarding no
PermitUserRC no
StrictModes no
# GitHub-hosted runner has password-locked service user; PAM permits
# public-key-only login while password and challenge auth remain disabled.
UsePAM yes
LogLevel VERBOSE
ForceCommand /usr/local/bin/vxi-health-check
CFG

sudo install -m 0755 scripts/remote/vxi-health-check /usr/local/bin/vxi-health-check
installed=1
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -D -f "$tmp/sshd_config" -E "$tmp/sshd.log" &
server_pid=$!

ready=0
for _ in $(seq 1 40); do
  if (echo >/dev/tcp/127.0.0.1/$port) >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.2
done
[[ "$ready" == 1 ]] || { echo 'Loopback sshd did not become ready.' >&2; exit 1; }

node - "$tmp" "$port" "$user" <<'JS'
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const [directory, port, user] = process.argv.slice(2);
const target = {
  host: '127.0.0.1', user,
  port: Number(port),
  identityFile: path.join(directory, 'client'),
  knownHostsFile: path.join(directory, 'known_hosts')
};
writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ mode: 'read_only', targets: { lab: target } }));
JS

if ! node bin/vxi-ops.mjs health --config "$tmp/config.json" --target lab > "$tmp/result.json"; then
  echo 'DIAG: LOOPBACK_HEALTH_CALL_FAILED' >&2
  if sudo grep -qi 'account is locked' "$tmp/sshd.log"; then
    echo 'DIAG: RUNNER_ACCOUNT_LOCKED' >&2
  elif sudo grep -qi 'authentication refused' "$tmp/sshd.log"; then
    echo 'DIAG: AUTHENTICATION_REFUSED' >&2
  elif sudo grep -qi 'not allowed' "$tmp/sshd.log"; then
    echo 'DIAG: USER_NOT_ALLOWED' >&2
  elif sudo grep -qi 'bad ownership or modes' "$tmp/sshd.log"; then
    echo 'DIAG: SSHD_FILE_PERMISSIONS' >&2
  else
    echo 'DIAG: SSH_TRANSPORT_OR_CLIENT_UNCLASSIFIED' >&2
  fi
  node --input-type=module - "$tmp/config.json" <<'JS'
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildSshInvocation } from './src/policy.mjs';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const inv = buildSshInvocation(config.targets.lab);
const attempt = spawnSync(inv.command, inv.args, { encoding: 'utf8', timeout: 10000 });
const msg = attempt.stderr || '';
const classification =
  /host key verification failed/i.test(msg) ? 'HOST_KEY_VERIFICATION' :
  /permission denied.*publickey/i.test(msg) ? 'PUBLIC_KEY_AUTHENTICATION' :
  /connection refused/i.test(msg) ? 'CONNECTION_REFUSED' :
  /bad configuration option|unsupported option|unknown option|bad command-line option|invalid argument/i.test(msg) ? 'UNSUPPORTED_SSH_OPTION' :
  /warning: permanently added/i.test(msg) ? 'HOST_KEY_ACCEPTANCE_UNEXPECTED' :
  'UNCLASSIFIED';
process.stderr.write('DIAG: SSH_CLIENT_' + classification + '\n');
JS
  exit 1
fi
node - "$tmp/result.json" <<'JS'
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(result.target, 'lab');
assert.equal(result.write_permission, false);
assert.equal(result.raw_output_exported, false);
assert.deepEqual(result.result, { health: 'PASS', service: 'UNKNOWN', storage: 'UNKNOWN' });
JS

printf '%s\n' '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"vxi_ssh_health","arguments":{"target":"lab"}}}' |
  VXI_OPS_CONFIG="$tmp/config.json" node bin/vxi-ops.mjs mcp > "$tmp/mcp-response.json"
node - "$tmp/mcp-response.json" <<'JS'
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const response = JSON.parse(readFileSync(process.argv[2], 'utf8').trim());
assert.equal(response.id, 7);
assert.equal(response.result.isError, false);
const body = JSON.parse(response.result.content[0].text);
assert.deepEqual(body.result, { health: 'PASS', service: 'UNKNOWN', storage: 'UNKNOWN' });
assert.equal(body.target, 'lab');
JS

# A known-host file with the *wrong generated host key* must fail without
# returning the actual SSH diagnostic or raw remote output to the MCP caller.
ssh-keygen -q -t ed25519 -N '' -f "$tmp/other-host"
printf '[127.0.0.1]:%s %s\n' "$port" "$(cat "$tmp/other-host.pub")" > "$tmp/wrong_known_hosts"
node - "$tmp" <<'JS'
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const c = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
c.targets.lab.knownHostsFile = path.join(dir, 'wrong_known_hosts');
writeFileSync(path.join(dir, 'wrong.json'), JSON.stringify(c));
JS
if node bin/vxi-ops.mjs health --config "$tmp/wrong.json" --target lab >"$tmp/wrong.stdout" 2>"$tmp/wrong.stderr"; then
  echo 'Wrong pinned host key was improperly accepted.' >&2
  exit 1
fi
[[ ! -s "$tmp/wrong.stdout" ]] || { echo 'Raw output escaped from failed SSH.' >&2; exit 1; }
grep -Fq 'Operation denied or unavailable' "$tmp/wrong.stderr"

# An arbitrary shell tool and extra command field are both denied before SSH.
printf '%s\n' \
 '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"exec","arguments":{"command":"whoami"}}}' \
 '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"vxi_ssh_health","arguments":{"target":"lab","command":"whoami"}}}' |
  VXI_OPS_CONFIG="$tmp/config.json" node bin/vxi-ops.mjs mcp > "$tmp/denied.jsonl"
node - "$tmp/denied.jsonl" <<'JS'
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const denied = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
assert.deepEqual(denied.map(x => x.id), [11, 12]);
assert.ok(denied.every(x => x.error?.code === -32602));
JS

echo 'PASS: disposable SSH localhost auth, fixed remote script, MCP, wrong-host-key and forbidden-command checks; cleanup trap installed.'
