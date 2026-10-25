import { spawn } from 'node:child_process';
import { buildSshInvocation, sanitizeHealthOutput } from './policy.mjs';

function executeSsh(command, args, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let overflow = false;
    let settled = false;
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } });
    const timer = setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(out, 'utf8') + chunk.length > 8192) {
        overflow = true;
        child.kill('SIGKILL');
      } else { out += chunk.toString('utf8'); }
    });
    child.on('error', () => { settled = true; clearTimeout(timer); reject(new Error('SSH_TRANSPORT_FAILED')); });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (overflow) return reject(new Error('REMOTE_OUTPUT_TOO_LARGE'));
      if (code !== 0) return reject(new Error('SSH_EXECUTION_FAILED'));
      resolve(out);
    });
  });
}

export async function getHealth(config, targetLabel, { runner = executeSsh } = {}) {
  if (config.mode !== 'read_only') throw new Error('SSH_DISABLED');
  if (!Object.hasOwn(config.targets, targetLabel)) throw new Error('TARGET_NOT_ALLOWLISTED');
  const { command, args } = buildSshInvocation(config.targets[targetLabel]);
  const raw = await runner(command, args);
  return {
    contract: 'VXI_SSH_HEALTH_V1',
    target: targetLabel, // stable public alias only, never real SSH host/IP
    result: sanitizeHealthOutput(raw),
    raw_output_exported: false,
    write_permission: false
  };
}
