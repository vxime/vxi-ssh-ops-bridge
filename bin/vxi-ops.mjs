#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, localPolicy, sanitizeHealthOutput } from '../src/policy.mjs';
import { getHealth } from '../src/ssh.mjs';
import { runStdioMcp } from '../src/mcp.mjs';

function flagValue(args, key) { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; }
const argv = process.argv.slice(2);
const action = argv[0] ?? 'help';
const configPath = flagValue(argv, '--config') || process.env.VXI_OPS_CONFIG;
const synthetic = fileURLToPath(new URL('../fixtures/health.json', import.meta.url));

try {
  if (action === 'demo') {
    process.stdout.write(JSON.stringify({ contract: 'VXI_SSH_HEALTH_V1', synthetic: true, result: sanitizeHealthOutput(await readFile(synthetic, 'utf8')) }, null, 2) + '\n');
  } else if (action === 'policy') {
    process.stdout.write(JSON.stringify(localPolicy(await loadConfig(configPath)), null, 2) + '\n');
  } else if (action === 'health') {
    const target = flagValue(argv, '--target');
    const config = await loadConfig(configPath);
    process.stdout.write(JSON.stringify(await getHealth(config, target), null, 2) + '\n');
  } else if (action === 'mcp') {
    await runStdioMcp(await loadConfig(configPath));
  } else {
    process.stdout.write('Usage: vxi-ops demo | policy [--config FILE] | health --config FILE --target ALIAS | mcp [--config FILE]\n');
  }
} catch {
  // No SSH stderr, host, paths, or remote output are echoed.
  process.stderr.write('Operation denied or unavailable. Check local configuration and pinned host key.\n');
  process.exitCode = 1;
}
