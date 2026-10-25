import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, buildSshInvocation, sanitizeHealthOutput, localPolicy, REMOTE_SCRIPT } from '../src/policy.mjs';
import { getHealth } from '../src/ssh.mjs';
import { handleRequest, toolList } from '../src/mcp.mjs';

const target = Object.freeze({ host: 'example.invalid', user: 'demo', port: 22, identityFile: '/tmp/demo-id', knownHostsFile: '/tmp/known_hosts' });
const active = { mode: 'read_only', targets: { lab: target } };
const off = { mode: 'disabled', targets: { lab: target } };

test('disabled by default and no privileged tools', async () => {
  assert.deepEqual(localPolicy(off).enabled, false);
  assert.deepEqual(toolList(off).map(t => t.name), ['vxi_ops_policy', 'vxi_ssh_health']);
  await assert.rejects(() => getHealth(off, 'lab', { runner: async () => '{"health":"PASS","service":"PASS","storage":"PASS"}' }), /SSH_DISABLED/);
});

test('strict target/host validation forbids option and shell injection', () => {
  for (const invalid of ['-oProxyCommand=evil', 'example.invalid;touch /tmp/pwn', 'user@host', 'ab..cd', '']) {
    assert.throws(() => validateConfig({ mode: 'read_only', targets: { lab: { ...target, host: invalid } } }));
  }
  assert.throws(() => validateConfig({ mode: 'read_only', targets: { lab: { ...target, command: 'rm -rf /' } } }), /TARGET_UNKNOWN_FIELD/);
  assert.throws(() => validateConfig({ mode: 'execute', targets: { lab: target } }), /CONFIG_MODE_INVALID/);
  assert.throws(() => validateConfig({ mode: 'read_only', targets: { production: target } }), /TARGET_INVALID/);
});

test('SSH invocation has a fixed remote script and security options', () => {
  const inv = buildSshInvocation(target);
  assert.equal(inv.command, 'ssh');
  assert.equal(inv.args.at(-1), REMOTE_SCRIPT);
  assert.ok(inv.args.includes('StrictHostKeyChecking=yes'));
  assert.ok(inv.args.includes('IdentitiesOnly=yes'));
  assert.ok(inv.args.includes('ProxyCommand=none'));
  assert.ok(inv.args.includes('/dev/null'));
  assert.ok(!inv.args.some(a => a.includes('rm -rf')));
});

test('sanitizer strips no raw SSH text through (reject instead)', () => {
  assert.deepEqual(sanitizeHealthOutput('{"health":"PASS","service":"UNKNOWN","storage":"FAIL"}'), { health: 'PASS', service: 'UNKNOWN', storage: 'FAIL' });
  assert.throws(() => sanitizeHealthOutput('{"health":"PASS","service":"PASS","storage":"PASS","secret":"SENSITIVE"}'), /OUTPUT_EXTRA_FIELD/);
  assert.throws(() => sanitizeHealthOutput('{"health":"PASS","service":"secret","storage":"PASS"}'), /OUTPUT_VALUE_INVALID/);
  assert.throws(() => sanitizeHealthOutput('Authorization: Bearer token'), /SyntaxError/);
});

test('read-only health can execute only one predefined command with safe result', async () => {
  let invoked;
  const runner = async (command, args) => { invoked = { command, args }; return '{"health":"PASS","service":"PASS","storage":"UNKNOWN"}'; };
  const result = await getHealth(active, 'lab', { runner });
  assert.equal(result.write_permission, false);
  assert.equal(result.raw_output_exported, false);
  assert.equal(result.result.health, 'PASS');
  assert.equal(invoked.args.at(-1), REMOTE_SCRIPT);
  await assert.rejects(() => getHealth(active, 'production', { runner }), /TARGET_NOT_ALLOWLISTED/);
});

test('MCP rejects arbitrary exec commands and never returns host details', async () => {
  const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'exec', arguments: { command: 'whoami' } } }, active);
  assert.equal(response.error.code, -32602);
  const extra = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'vxi_ssh_health', arguments: { target: 'lab', command: 'cat /etc/passwd' } } }, active);
  assert.equal(extra.error.code, -32602);
  const safe = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vxi_ssh_health', arguments: { target: 'lab' } } }, active, { runner: async () => '{"health":"PASS","service":"PASS","storage":"PASS"}' });
  assert.equal(safe.result.isError, false);
  assert.doesNotMatch(JSON.stringify(safe), /example\.invalid|\/tmp\/demo-id|whoami/i);
});

test('stdio transport is read-only and disabled without local config', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const entry = fileURLToPath(new URL('../bin/vxi-ops.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
    let stdout = '';
    child.stdout.on('data', x => { stdout += x.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout }));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 18, method: 'tools/list' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'vxi_ssh_health', arguments: { target: 'lab' } } }) + '\n');
    child.stdin.end();
  });
  assert.equal(result.code, 0);
  const responses = result.stdout.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(responses.length, 2);
  assert.deepEqual(responses[0].result.tools.map(x => x.name), ['vxi_ops_policy', 'vxi_ssh_health']);
  assert.equal(responses[1].error.code, -32602); // no targets without config
});
