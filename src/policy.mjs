import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';

export const REMOTE_SCRIPT = '/usr/local/bin/vxi-health-check';
export const CHECK_VALUES = new Set(['PASS', 'FAIL', 'UNKNOWN']);
const LABEL_RE = /^(lab|sandbox|staging)$/; // Generic, non-identifying aliases only; production excluded.
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/;
const ALLOWED_ROOT_KEYS = new Set(['mode', 'targets']);
const ALLOWED_TARGET_KEYS = new Set(['host', 'user', 'port', 'identityFile', 'knownHostsFile']);

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('CONFIG_INVALID');
  if (Object.keys(config).some(k => !ALLOWED_ROOT_KEYS.has(k))) throw new Error('CONFIG_UNKNOWN_FIELD');
  if (!['disabled', 'read_only'].includes(config.mode)) throw new Error('CONFIG_MODE_INVALID');
  if (!config.targets || typeof config.targets !== 'object' || Array.isArray(config.targets)) throw new Error('CONFIG_TARGETS_INVALID');
  const entries = Object.entries(config.targets);
  if (entries.length > 10) throw new Error('TOO_MANY_TARGETS');
  for (const [label, target] of entries) {
    if (!LABEL_RE.test(label) || !target || typeof target !== 'object' || Array.isArray(target)) throw new Error('TARGET_INVALID');
    if (Object.keys(target).some(k => !ALLOWED_TARGET_KEYS.has(k))) throw new Error('TARGET_UNKNOWN_FIELD');
    if (typeof target.host !== 'string' || !HOST_RE.test(target.host) || target.host.startsWith('-') || target.host.includes('..')) throw new Error('HOST_INVALID');
    if (typeof target.user !== 'string' || !USER_RE.test(target.user)) throw new Error('SSH_USER_INVALID');
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw new Error('PORT_INVALID');
    if (typeof target.identityFile !== 'string' || !path.isAbsolute(target.identityFile)) throw new Error('IDENTITY_PATH_INVALID');
    if (typeof target.knownHostsFile !== 'string' || !path.isAbsolute(target.knownHostsFile)) throw new Error('KNOWN_HOSTS_PATH_INVALID');
    if (/[\r\n\0]/.test(target.identityFile) || /[\r\n\0]/.test(target.knownHostsFile)) throw new Error('PATH_CONTROL_CHARACTER');
  }
  return config;
}

export async function loadConfig(configPath) {
  if (!configPath) return { mode: 'disabled', targets: {} };
  const stat = await lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('CONFIG_FILE_UNSAFE');
  const input = JSON.parse(await readFile(configPath, 'utf8'));
  return validateConfig(input);
}

export function localPolicy(config) {
  return {
    boundary: 'VXI_SSH_READ_ONLY_V1',
    enabled: config.mode === 'read_only',
    allowed_targets: Object.keys(config.targets),
    tools: ['vxi_ops_policy', 'vxi_ssh_health'],
    shell_exposed: false,
    write_actions_exposed: false,
    output: 'STRICT_ENUMS_ONLY'
  };
}

export function buildSshInvocation(target) {
  validateConfig({ mode: 'read_only', targets: { lab: target } });
  // No model input or user-supplied command is interpolated into remote script.
  // Ignore personal SSH config, refuse unpinned host keys, agent identities and prompts.
  return {
    command: 'ssh',
    args: [
      '-F', '/dev/null',
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${target.knownHostsFile}`,
      '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'IdentityAgent=none',
      '-o', 'ForwardAgent=no',
      '-o', 'ClearAllForwardings=yes',
      '-o', 'PermitLocalCommand=no',
      '-o', 'ProxyCommand=none',
      '-o', 'ProxyJump=none',
      '-o', 'ConnectTimeout=5',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-i', target.identityFile,
      '-p', String(target.port),
      '--', `${target.user}@${target.host}`,
      REMOTE_SCRIPT
    ]
  };
}

export function sanitizeHealthOutput(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 8192) throw new Error('REMOTE_OUTPUT_TOO_LARGE');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('OUTPUT_INVALID');
  if (Object.keys(data).sort().join(',') !== 'health,service,storage') throw new Error('OUTPUT_EXTRA_FIELD');
  for (const value of Object.values(data)) {
    if (!CHECK_VALUES.has(value)) throw new Error('OUTPUT_VALUE_INVALID');
  }
  return { health: data.health, service: data.service, storage: data.storage };
}
