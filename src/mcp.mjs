import readline from 'node:readline';
import { getHealth } from './ssh.mjs';
import { localPolicy } from './policy.mjs';

export function toolList(config) {
  return [
    {
      name: 'vxi_ops_policy',
      title: 'Read SSH bridge permission policy',
      description: 'Returns only capability enums and safe target aliases.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'vxi_ssh_health',
      title: 'Run a fixed read-only health check',
      description: 'Calls a locally pinned remote script. No arbitrary command, file access, or raw logs.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string', enum: Object.keys(config.targets) } },
        required: ['target'],
        additionalProperties: false
      }
    }
  ];
}

export async function handleRequest(message, config, options = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  }
  const { id, method, params } = message;
  if (id === undefined) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, reason) => ({ jsonrpc: '2.0', id, error: { code, message: reason } });
  if (method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'vxi-ssh-ops-bridge', version: '0.1.0' } });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: toolList(config) });
  if (method !== 'tools/call') return fail(-32601, 'Method not found');
  if (!params || !['vxi_ops_policy', 'vxi_ssh_health'].includes(params.name)) return fail(-32602, 'Unknown or forbidden tool');
  const args = params.arguments ?? {};
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return fail(-32602, 'Arguments invalid');
  if (params.name === 'vxi_ops_policy') {
    if (Object.keys(args).length) return fail(-32602, 'Unexpected arguments');
    return ok({ content: [{ type: 'text', text: JSON.stringify(localPolicy(config)) }], isError: false });
  }
  if (Object.keys(args).length !== 1 || typeof args.target !== 'string' || !Object.hasOwn(config.targets, args.target)) {
    return fail(-32602, 'Invalid target or extra parameters');
  }
  try {
    const output = await getHealth(config, args.target, options);
    return ok({ content: [{ type: 'text', text: JSON.stringify(output) }], isError: false });
  } catch {
    return fail(-32000, 'REMOTE_HEALTH_UNAVAILABLE');
  }
}

export async function runStdioMcp(config) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request;
    try { if (line.length > 8192) throw new Error('too long'); request = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    const response = await handleRequest(request, config);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
