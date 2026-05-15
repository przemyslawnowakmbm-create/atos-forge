#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSafe } = require('../forge-cli/lib/exec');
// scope-env is loaded lazily so this file is usable before P3 lands.
let _scopeEnv = null;
function loadScopeEnv() {
  if (_scopeEnv !== null) return _scopeEnv;
  try {
    _scopeEnv = require('./scope-env');
  } catch {
    _scopeEnv = { scopeEnvForAgent: null };
  }
  return _scopeEnv;
}

const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    binary: 'claude',
    container_supported: true,
    commonPaths: [
      path.join(os.homedir(), '.claude', 'local', 'claude'),
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ],
  },
  codex: {
    label: 'Codex',
    binary: 'codex',
    container_supported: false,
    commonPaths: [
      '/Applications/Codex.app/Contents/Resources/codex',
      path.join(os.homedir(), '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
    ],
  },
};

function loadConfig(cwd) {
  if (!cwd) return null;
  try {
    return require('../forge-config/config').loadConfig(cwd).config;
  } catch {
    return null;
  }
}

function normalizeProviderName(name) {
  if (!name) return 'auto';
  const normalized = String(name).trim().toLowerCase();
  return PROVIDERS[normalized] ? normalized : 'auto';
}

function inferProviderFromInstallPath() {
  const hints = [__dirname, process.argv[1] || '', process.env.PWD || ''];
  for (const hint of hints) {
    if (!hint) continue;
    if (hint.includes(`${path.sep}.codex${path.sep}`)) return 'codex';
    if (hint.includes(`${path.sep}.claude${path.sep}`)) return 'claude';
  }
  return null;
}

function providerPreference(cwd, opts = {}) {
  const optionProvider = normalizeProviderName(opts.provider);
  const envProvider = normalizeProviderName(process.env.FORGE_AGENT_PROVIDER);
  const configProvider = normalizeProviderName(loadConfig(cwd)?.agents?.provider);
  const pathProvider = normalizeProviderName(inferProviderFromInstallPath());
  const explicit = optionProvider !== 'auto'
    ? optionProvider
    : envProvider !== 'auto'
      ? envProvider
      : configProvider !== 'auto'
        ? configProvider
        : pathProvider;

  if (explicit !== 'auto') return [explicit];
  if (inferProviderFromInstallPath() === 'codex') return ['codex', 'claude'];
  return ['claude', 'codex'];
}

function findProviderBinary(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) return null;

  try {
    const which = execFileSafe('which', [provider.binary], {
      stdio: 'pipe',
      timeout: 5000,
      allowFailure: true,
    });
    if (which) return which;
  } catch { /* not in PATH */ }

  for (const candidate of provider.commonPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function checkProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return { name: providerName, label: providerName, available: false, path: null, version: null, container_supported: false };
  }

  const binaryPath = findProviderBinary(providerName);
  if (!binaryPath) {
    return {
      name: providerName,
      label: provider.label,
      available: false,
      path: null,
      version: null,
      container_supported: provider.container_supported,
    };
  }

  try {
    const version = execFileSafe(binaryPath, ['--version'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10000,
      allowFailure: true,
    });
    return {
      name: providerName,
      label: provider.label,
      available: true,
      path: binaryPath,
      version: version || 'unknown',
      container_supported: provider.container_supported,
    };
  } catch {
    return {
      name: providerName,
      label: provider.label,
      available: true,
      path: binaryPath,
      version: 'unknown',
      container_supported: provider.container_supported,
    };
  }
}

function resolveProvider(cwd, opts = {}) {
  const preference = providerPreference(cwd, opts);
  for (const name of preference) {
    const checked = checkProvider(name);
    if (checked.available) return checked;
  }
  return checkProvider(preference[0] || 'claude');
}

function buildInvocation(providerName, prompt, opts = {}) {
  const outputFile = opts.outputFile || null;
  const secretsScope = Array.isArray(opts.secrets_scope) ? opts.secrets_scope : [];
  const envScopeEnabled = opts.env_allowlist_enabled === true;

  const buildEnv = (extras) => {
    const base = { ...process.env, ...(extras || {}) };
    if (!envScopeEnabled) return base;
    const { scopeEnvForAgent } = loadScopeEnv();
    if (typeof scopeEnvForAgent !== 'function') return base;
    return scopeEnvForAgent(process.env, secretsScope, extras || {});
  };

  // P8: delegate argv/env construction to the runtime adapter.
  let runtimes = null;
  try { runtimes = require('../forge-runtimes'); }
  catch { runtimes = null; }

  // Map legacy provider names → runtime adapter names.
  const runtimeKey = providerName === 'claude' ? 'claude-code' : providerName;
  const adapter = runtimes && runtimes.get && runtimes.get(runtimeKey);

  if (adapter && typeof adapter.build === 'function') {
    const built = adapter.build(prompt, { ...opts, outputFile });
    return {
      args: built.args,
      stdin: built.stdin == null ? null : built.stdin,
      outputFile,
      env: buildEnv(built.env || {}),
    };
  }

  // Fallback (runtime adapter unavailable — should not happen post-P8).
  if (providerName === 'codex') {
    const model = opts.model || null;
    const args = ['exec', '--full-auto', '--skip-git-repo-check'];
    if (model) args.push('-m', model);
    if (outputFile) args.push('-o', outputFile);
    args.push('-');
    return { args, stdin: prompt, outputFile, env: buildEnv({ TERM: 'dumb' }) };
  }
  const baseTools = Array.isArray(opts.allowedTools)
    ? opts.allowedTools.join(',')
    : (opts.allowedTools || 'Bash,Read,Write,Edit,Glob,Grep');
  const finalTools = opts.delegate_to_agents === true
    ? `${baseTools},Agent`
    : baseTools;
  const useDangerous = opts.dangerously_skip_permissions !== false;
  const args = ['--print'];
  if (useDangerous) args.push('--dangerously-skip-permissions');
  args.push('-p', prompt, '--allowedTools', finalTools);
  if (Array.isArray(opts.disallowedTools) && opts.disallowedTools.length > 0) {
    args.push('--disallowedTools', opts.disallowedTools.join(','));
  }
  const model = opts.model || null;
  if (model && model !== 'inherit') args.splice(1, 0, '--model', model);
  return {
    args,
    stdin: null,
    outputFile,
    env: buildEnv({
      TERM: 'dumb',
      CLAUDE_CODE_ENTRYPOINT: opts.entrypoint || process.env.CLAUDE_CODE_ENTRYPOINT,
    }),
  };
}

module.exports = {
  PROVIDERS,
  normalizeProviderName,
  inferProviderFromInstallPath,
  providerPreference,
  findProviderBinary,
  checkProvider,
  resolveProvider,
  buildInvocation,
};
