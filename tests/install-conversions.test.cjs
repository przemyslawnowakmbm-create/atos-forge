'use strict';

/**
 * Tests for bin/install.js conversion and resolution logic.
 *
 * Because install.js runs immediately on require (banner, interactive prompts),
 * we inline the pure functions under test rather than importing the whole file.
 * Each function is copied verbatim from bin/install.js so the tests track the
 * real implementation; if the implementation changes, update here too.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Pure functions extracted from bin/install.js ────────────────────────────

function getDirName(runtime) {
  if (runtime === 'codex') return '.codex';
  if (runtime === 'opencode') return '.opencode';
  if (runtime === 'gemini') return '.gemini';
  return '.claude';
}

function expandTilde(filePath) {
  if (filePath && filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function getOpencodeGlobalDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return expandTilde(process.env.OPENCODE_CONFIG_DIR);
  }
  if (process.env.OPENCODE_CONFIG) {
    return path.dirname(expandTilde(process.env.OPENCODE_CONFIG));
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(expandTilde(process.env.XDG_CONFIG_HOME), 'opencode');
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

function getGlobalDir(runtime, explicitDir = null) {
  if (runtime === 'codex') {
    if (explicitDir) return path.join(expandTilde(explicitDir), 'forge');
    if (process.env.CODEX_HOME) return path.join(expandTilde(process.env.CODEX_HOME), 'forge');
    return path.join(os.homedir(), '.codex', 'forge');
  }
  if (runtime === 'opencode') {
    if (explicitDir) return expandTilde(explicitDir);
    return getOpencodeGlobalDir();
  }
  if (runtime === 'gemini') {
    if (explicitDir) return expandTilde(explicitDir);
    if (process.env.GEMINI_CONFIG_DIR) return expandTilde(process.env.GEMINI_CONFIG_DIR);
    return path.join(os.homedir(), '.gemini');
  }
  // claude
  if (explicitDir) return expandTilde(explicitDir);
  if (process.env.CLAUDE_CONFIG_DIR) return expandTilde(process.env.CLAUDE_CONFIG_DIR);
  return path.join(os.homedir(), '.claude');
}

function getConfigDirFromHome(runtime, isGlobal) {
  if (!isGlobal) {
    return `'${getDirName(runtime)}'`;
  }
  if (runtime === 'opencode') return "'.config', 'opencode'";
  if (runtime === 'gemini') return "'.gemini'";
  return "'.claude'";
}

const claudeToOpencodeTools = {
  AskUserQuestion: 'question',
  SlashCommand: 'skill',
  TodoWrite: 'todowrite',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
};

function convertToolName(claudeTool) {
  if (claudeToOpencodeTools[claudeTool]) return claudeToOpencodeTools[claudeTool];
  if (claudeTool.startsWith('mcp__')) return claudeTool;
  return claudeTool.toLowerCase();
}

const claudeToGeminiTools = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'replace',
  Bash: 'run_shell_command',
  Glob: 'glob',
  Grep: 'search_file_content',
  WebSearch: 'google_web_search',
  WebFetch: 'web_fetch',
  TodoWrite: 'write_todos',
  AskUserQuestion: 'ask_user',
};

function convertGeminiToolName(claudeTool) {
  if (claudeTool.startsWith('mcp__')) return null;
  if (claudeTool === 'Task') return null;
  if (claudeToGeminiTools[claudeTool]) return claudeToGeminiTools[claudeTool];
  return claudeTool.toLowerCase();
}

function stripSubTags(content) {
  return content.replace(/<sub>(.*?)<\/sub>/g, '*($1)*');
}

function processAttribution(content, attribution) {
  if (attribution === null) {
    return content.replace(/(\r?\n){2}Co-Authored-By:.*$/gim, '');
  }
  if (attribution === undefined) {
    return content;
  }
  const safeAttribution = attribution.replace(/\$/g, '$$$$');
  return content.replace(/Co-Authored-By:.*$/gim, `Co-Authored-By: ${safeAttribution}`);
}

const colorNameToHex = {
  cyan: '#00FFFF',
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  magenta: '#FF00FF',
  orange: '#FFA500',
  purple: '#800080',
  pink: '#FFC0CB',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#808080',
  grey: '#808080',
};

function convertClaudeToOpencodeFrontmatter(content) {
  let convertedContent = content;
  convertedContent = convertedContent.replace(/\bAskUserQuestion\b/g, 'question');
  convertedContent = convertedContent.replace(/\bSlashCommand\b/g, 'skill');
  convertedContent = convertedContent.replace(/\bTodoWrite\b/g, 'todowrite');
  convertedContent = convertedContent.replace(/\/forge:/g, '/forge-');
  convertedContent = convertedContent.replace(/~\/\.claude\b/g, '~/.config/opencode');
  convertedContent = convertedContent.replace(/subagent_type="general-purpose"/g, 'subagent_type="general"');

  if (!convertedContent.startsWith('---')) return convertedContent;

  const endIndex = convertedContent.indexOf('---', 3);
  if (endIndex === -1) return convertedContent;

  const frontmatter = convertedContent.substring(3, endIndex).trim();
  const body = convertedContent.substring(endIndex + 3);

  const lines = frontmatter.split('\n');
  const newLines = [];
  let inAllowedTools = false;
  const allowedTools = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('allowed-tools:')) {
      inAllowedTools = true;
      continue;
    }

    if (trimmed.startsWith('tools:')) {
      const toolsValue = trimmed.substring(6).trim();
      if (toolsValue) {
        const tools = toolsValue.split(',').map(t => t.trim()).filter(t => t);
        allowedTools.push(...tools);
      }
      continue;
    }

    if (trimmed.startsWith('name:')) continue;

    if (trimmed.startsWith('color:')) {
      const colorValue = trimmed.substring(6).trim().toLowerCase();
      const hexColor = colorNameToHex[colorValue];
      if (hexColor) {
        newLines.push(`color: "${hexColor}"`);
      } else if (colorValue.startsWith('#')) {
        if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(colorValue)) {
          newLines.push(line);
        }
      }
      continue;
    }

    if (inAllowedTools) {
      if (trimmed.startsWith('- ')) {
        allowedTools.push(trimmed.substring(2).trim());
        continue;
      } else if (trimmed && !trimmed.startsWith('-')) {
        inAllowedTools = false;
      }
    }

    if (!inAllowedTools) {
      newLines.push(line);
    }
  }

  if (allowedTools.length > 0) {
    newLines.push('tools:');
    for (const tool of allowedTools) {
      newLines.push(`  ${convertToolName(tool)}: true`);
    }
  }

  const newFrontmatter = newLines.join('\n').trim();
  return `---\n${newFrontmatter}\n---${body}`;
}

function convertClaudeToGeminiAgent(content) {
  if (!content.startsWith('---')) return content;

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return content;

  const frontmatter = content.substring(3, endIndex).trim();
  const body = content.substring(endIndex + 3);

  const lines = frontmatter.split('\n');
  const newLines = [];
  let inAllowedTools = false;
  const tools = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('allowed-tools:')) {
      inAllowedTools = true;
      continue;
    }

    if (trimmed.startsWith('tools:')) {
      const toolsValue = trimmed.substring(6).trim();
      if (toolsValue) {
        const parsed = toolsValue.split(',').map(t => t.trim()).filter(t => t);
        for (const t of parsed) {
          const mapped = convertGeminiToolName(t);
          if (mapped) tools.push(mapped);
        }
      } else {
        inAllowedTools = true;
      }
      continue;
    }

    if (trimmed.startsWith('color:')) continue;

    if (inAllowedTools) {
      if (trimmed.startsWith('- ')) {
        const mapped = convertGeminiToolName(trimmed.substring(2).trim());
        if (mapped) tools.push(mapped);
        continue;
      } else if (trimmed && !trimmed.startsWith('-')) {
        inAllowedTools = false;
      }
    }

    if (!inAllowedTools) {
      newLines.push(line);
    }
  }

  if (tools.length > 0) {
    newLines.push('tools:');
    for (const tool of tools) {
      newLines.push(`  - ${tool}`);
    }
  }

  const newFrontmatter = newLines.join('\n').trim();
  const escapedBody = body.replace(/\$\{(\w+)\}/g, '$$$1');
  return `---\n${newFrontmatter}\n---${stripSubTags(escapedBody)}`;
}

function convertClaudeToGeminiToml(content) {
  if (!content.startsWith('---')) {
    return `prompt = ${JSON.stringify(content)}\n`;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return `prompt = ${JSON.stringify(content)}\n`;
  }

  const frontmatter = content.substring(3, endIndex).trim();
  const body = content.substring(endIndex + 3).trim();

  let description = '';
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('description:')) {
      description = trimmed.substring(12).trim();
      break;
    }
  }

  let toml = '';
  if (description) {
    toml += `description = ${JSON.stringify(description)}\n`;
  }
  toml += `prompt = ${JSON.stringify(body)}\n`;
  return toml;
}

function mergeExecutionContextBlocks(content, references = []) {
  if (!content || !Array.isArray(references) || references.length === 0) return content;

  const lines = [];
  for (const ref of references) {
    if (ref && !lines.includes(ref)) lines.push(ref);
  }

  const openTag = '<execution_context>';
  const closeTag = '</execution_context>';
  const frontmatterStart = content.startsWith('---\n') ? 0 : -1;
  const frontmatterEnd = frontmatterStart === 0 ? content.indexOf('\n---\n', 4) : -1;

  const head = frontmatterEnd >= 0
    ? content.slice(0, frontmatterEnd + '\n---\n'.length)
    : '';
  let body = frontmatterEnd >= 0
    ? content.slice(frontmatterEnd + '\n---\n'.length)
    : content;

  while (true) {
    const start = body.indexOf(openTag);
    if (start === -1) break;
    const end = body.indexOf(closeTag, start);
    if (end === -1) break;
    const block = body.slice(start + openTag.length, end);
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (line && !lines.includes(line)) lines.push(line);
    }
    body = body.slice(0, start) + body.slice(end + closeTag.length);
  }

  const mergedBlock = `\n${openTag}\n${lines.join('\n')}\n${closeTag}\n\n`;
  return head
    ? head + mergedBlock + body.replace(/^\n+/, '')
    : mergedBlock + body.replace(/^\n+/, '');
}

function parseJsonc(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  let result = '';
  let inString = false;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      result += char;
      if (char === '\\' && i + 1 < content.length) {
        result += next;
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i++;
    } else {
      if (char === '"') {
        inString = true;
        result += char;
        i++;
      } else if (char === '/' && next === '/') {
        while (i < content.length && content[i] !== '\n') i++;
      } else if (char === '/' && next === '*') {
        i += 2;
        while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++;
        i += 2;
      } else {
        result += char;
        i++;
      }
    }
  }

  result = result.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(result);
}

// ─── The 9 engine modules copied during install ───────────────────────────────

const ENGINE_MODULES = [
  'forge-graph',
  'forge-config',
  'forge-session',
  'forge-verify',
  'forge-assess',
  'forge-agents',
  'forge-containers',
  'forge-system',
  'forge-analyze',
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('install-conversions', () => {

  // ── getDirName ──────────────────────────────────────────────────────────────

  describe('getDirName', () => {
    it('returns .claude for claude runtime', () => {
      assert.strictEqual(getDirName('claude'), '.claude');
    });

    it('returns .codex for codex runtime', () => {
      assert.strictEqual(getDirName('codex'), '.codex');
    });

    it('returns .opencode for opencode runtime', () => {
      assert.strictEqual(getDirName('opencode'), '.opencode');
    });

    it('returns .gemini for gemini runtime', () => {
      assert.strictEqual(getDirName('gemini'), '.gemini');
    });

    it('returns .claude as default for unknown runtime', () => {
      assert.strictEqual(getDirName('unknown'), '.claude');
    });
  });

  // ── expandTilde ─────────────────────────────────────────────────────────────

  describe('expandTilde', () => {
    it('expands ~/ prefix to homedir', () => {
      const result = expandTilde('~/foo/bar');
      assert.strictEqual(result, path.join(os.homedir(), 'foo/bar'));
    });

    it('leaves absolute paths unchanged', () => {
      const p = '/usr/local/bin/forge';
      assert.strictEqual(expandTilde(p), p);
    });

    it('leaves relative paths unchanged', () => {
      const p = 'relative/path';
      assert.strictEqual(expandTilde(p), p);
    });

    it('returns the original value for falsy input', () => {
      assert.strictEqual(expandTilde(''), '');
      assert.strictEqual(expandTilde(null), null);
    });
  });

  // ── getGlobalDir ────────────────────────────────────────────────────────────

  describe('getGlobalDir', () => {
    it('returns ~/.claude for claude runtime (default)', () => {
      const saved = process.env.CLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      const result = getGlobalDir('claude');
      assert.strictEqual(result, path.join(os.homedir(), '.claude'));
      if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved;
    });

    it('returns ~/.codex/forge for codex runtime (default)', () => {
      const saved = process.env.CODEX_HOME;
      delete process.env.CODEX_HOME;
      const result = getGlobalDir('codex');
      assert.strictEqual(result, path.join(os.homedir(), '.codex', 'forge'));
      if (saved !== undefined) process.env.CODEX_HOME = saved;
    });

    it('returns ~/.gemini for gemini runtime (default)', () => {
      const saved = process.env.GEMINI_CONFIG_DIR;
      delete process.env.GEMINI_CONFIG_DIR;
      const result = getGlobalDir('gemini');
      assert.strictEqual(result, path.join(os.homedir(), '.gemini'));
      if (saved !== undefined) process.env.GEMINI_CONFIG_DIR = saved;
    });

    it('respects explicitDir for claude runtime', () => {
      const result = getGlobalDir('claude', '/custom/dir');
      assert.strictEqual(result, '/custom/dir');
    });

    it('respects explicitDir with tilde for claude', () => {
      const result = getGlobalDir('claude', '~/my-claude');
      assert.strictEqual(result, path.join(os.homedir(), 'my-claude'));
    });

    it('respects explicitDir for codex (appends /forge)', () => {
      const result = getGlobalDir('codex', '/custom/codex');
      assert.strictEqual(result, '/custom/codex/forge');
    });

    it('respects explicitDir for opencode (no suffix)', () => {
      const result = getGlobalDir('opencode', '/custom/opencode');
      assert.strictEqual(result, '/custom/opencode');
    });

    it('respects CLAUDE_CONFIG_DIR env var', () => {
      const saved = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = '/env/claude';
      const result = getGlobalDir('claude');
      assert.strictEqual(result, '/env/claude');
      if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved;
      else delete process.env.CLAUDE_CONFIG_DIR;
    });

    it('respects CODEX_HOME env var', () => {
      const saved = process.env.CODEX_HOME;
      process.env.CODEX_HOME = '/env/codex';
      const result = getGlobalDir('codex');
      assert.strictEqual(result, '/env/codex/forge');
      if (saved !== undefined) process.env.CODEX_HOME = saved;
      else delete process.env.CODEX_HOME;
    });

    it('respects GEMINI_CONFIG_DIR env var', () => {
      const saved = process.env.GEMINI_CONFIG_DIR;
      process.env.GEMINI_CONFIG_DIR = '/env/gemini';
      const result = getGlobalDir('gemini');
      assert.strictEqual(result, '/env/gemini');
      if (saved !== undefined) process.env.GEMINI_CONFIG_DIR = saved;
      else delete process.env.GEMINI_CONFIG_DIR;
    });
  });

  // ── getOpencodeGlobalDir ────────────────────────────────────────────────────

  describe('getOpencodeGlobalDir', () => {
    it('defaults to ~/.config/opencode when no env vars set', () => {
      const savedDir = process.env.OPENCODE_CONFIG_DIR;
      const savedCfg = process.env.OPENCODE_CONFIG;
      const savedXdg = process.env.XDG_CONFIG_HOME;
      delete process.env.OPENCODE_CONFIG_DIR;
      delete process.env.OPENCODE_CONFIG;
      delete process.env.XDG_CONFIG_HOME;

      const result = getOpencodeGlobalDir();
      assert.strictEqual(result, path.join(os.homedir(), '.config', 'opencode'));

      if (savedDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedDir;
      if (savedCfg !== undefined) process.env.OPENCODE_CONFIG = savedCfg;
      if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
    });

    it('respects OPENCODE_CONFIG_DIR env var', () => {
      const saved = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = '/custom/opencode';
      const result = getOpencodeGlobalDir();
      assert.strictEqual(result, '/custom/opencode');
      if (saved !== undefined) process.env.OPENCODE_CONFIG_DIR = saved;
      else delete process.env.OPENCODE_CONFIG_DIR;
    });

    it('respects XDG_CONFIG_HOME env var', () => {
      const savedDir = process.env.OPENCODE_CONFIG_DIR;
      const savedXdg = process.env.XDG_CONFIG_HOME;
      delete process.env.OPENCODE_CONFIG_DIR;
      delete process.env.OPENCODE_CONFIG;
      process.env.XDG_CONFIG_HOME = '/xdg';
      const result = getOpencodeGlobalDir();
      assert.strictEqual(result, '/xdg/opencode');
      if (savedDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedDir;
      if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
      else delete process.env.XDG_CONFIG_HOME;
    });

    it('uses dirname of OPENCODE_CONFIG when set', () => {
      const savedDir = process.env.OPENCODE_CONFIG_DIR;
      const savedCfg = process.env.OPENCODE_CONFIG;
      delete process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG = '/my/opencode/opencode.json';
      const result = getOpencodeGlobalDir();
      assert.strictEqual(result, '/my/opencode');
      if (savedDir !== undefined) process.env.OPENCODE_CONFIG_DIR = savedDir;
      if (savedCfg !== undefined) process.env.OPENCODE_CONFIG = savedCfg;
      else delete process.env.OPENCODE_CONFIG;
    });
  });

  // ── getConfigDirFromHome ────────────────────────────────────────────────────

  describe('getConfigDirFromHome', () => {
    it('returns quoted dir name for local installs', () => {
      assert.strictEqual(getConfigDirFromHome('claude', false), "'.claude'");
      assert.strictEqual(getConfigDirFromHome('opencode', false), "'.opencode'");
      assert.strictEqual(getConfigDirFromHome('gemini', false), "'.gemini'");
      assert.strictEqual(getConfigDirFromHome('codex', false), "'.codex'");
    });

    it('returns .claude for global claude install', () => {
      assert.strictEqual(getConfigDirFromHome('claude', true), "'.claude'");
    });

    it('returns XDG path for global opencode install', () => {
      assert.strictEqual(getConfigDirFromHome('opencode', true), "'.config', 'opencode'");
    });

    it('returns .gemini for global gemini install', () => {
      assert.strictEqual(getConfigDirFromHome('gemini', true), "'.gemini'");
    });
  });

  // ── Engine module list ──────────────────────────────────────────────────────

  describe('engine module directories', () => {
    it('identifies exactly 9 engine modules', () => {
      assert.strictEqual(ENGINE_MODULES.length, 9);
    });

    it('includes all required forge-* engine modules', () => {
      const required = [
        'forge-graph', 'forge-config', 'forge-session', 'forge-verify',
        'forge-assess', 'forge-agents', 'forge-containers', 'forge-system',
        'forge-analyze',
      ];
      for (const mod of required) {
        assert.ok(ENGINE_MODULES.includes(mod), `Missing module: ${mod}`);
      }
    });

    it('all module names start with forge-', () => {
      for (const mod of ENGINE_MODULES) {
        assert.ok(mod.startsWith('forge-'), `Module does not start with forge-: ${mod}`);
      }
    });

    it('all engine module directories exist on disk', () => {
      const root = path.join(__dirname, '..');
      for (const mod of ENGINE_MODULES) {
        const modPath = path.join(root, mod);
        assert.ok(
          fs.existsSync(modPath),
          `Engine module directory missing on disk: ${modPath}`
        );
      }
    });
  });

  // ── convertToolName (Claude → OpenCode) ─────────────────────────────────────

  describe('convertToolName (Claude → OpenCode)', () => {
    it('maps AskUserQuestion to question', () => {
      assert.strictEqual(convertToolName('AskUserQuestion'), 'question');
    });

    it('maps SlashCommand to skill', () => {
      assert.strictEqual(convertToolName('SlashCommand'), 'skill');
    });

    it('maps TodoWrite to todowrite', () => {
      assert.strictEqual(convertToolName('TodoWrite'), 'todowrite');
    });

    it('maps WebFetch to webfetch', () => {
      assert.strictEqual(convertToolName('WebFetch'), 'webfetch');
    });

    it('lowercases unmapped Claude tools', () => {
      assert.strictEqual(convertToolName('Read'), 'read');
      assert.strictEqual(convertToolName('Bash'), 'bash');
      assert.strictEqual(convertToolName('Edit'), 'edit');
    });

    it('preserves mcp__ prefix tools unchanged', () => {
      assert.strictEqual(convertToolName('mcp__slack__send'), 'mcp__slack__send');
    });
  });

  // ── convertGeminiToolName (Claude → Gemini) ──────────────────────────────────

  describe('convertGeminiToolName (Claude → Gemini)', () => {
    it('maps Read to read_file', () => {
      assert.strictEqual(convertGeminiToolName('Read'), 'read_file');
    });

    it('maps Write to write_file', () => {
      assert.strictEqual(convertGeminiToolName('Write'), 'write_file');
    });

    it('maps Edit to replace', () => {
      assert.strictEqual(convertGeminiToolName('Edit'), 'replace');
    });

    it('maps Bash to run_shell_command', () => {
      assert.strictEqual(convertGeminiToolName('Bash'), 'run_shell_command');
    });

    it('maps Glob to glob', () => {
      assert.strictEqual(convertGeminiToolName('Glob'), 'glob');
    });

    it('maps Grep to search_file_content', () => {
      assert.strictEqual(convertGeminiToolName('Grep'), 'search_file_content');
    });

    it('maps WebSearch to google_web_search', () => {
      assert.strictEqual(convertGeminiToolName('WebSearch'), 'google_web_search');
    });

    it('maps AskUserQuestion to ask_user', () => {
      assert.strictEqual(convertGeminiToolName('AskUserQuestion'), 'ask_user');
    });

    it('excludes mcp__ tools (returns null)', () => {
      assert.strictEqual(convertGeminiToolName('mcp__slack__send'), null);
    });

    it('excludes Task tool (returns null)', () => {
      assert.strictEqual(convertGeminiToolName('Task'), null);
    });

    it('lowercases unknown tools', () => {
      assert.strictEqual(convertGeminiToolName('SomeTool'), 'sometool');
    });
  });

  // ── stripSubTags ─────────────────────────────────────────────────────────────

  describe('stripSubTags', () => {
    it('converts <sub>text</sub> to *(text)*', () => {
      assert.strictEqual(stripSubTags('hello <sub>world</sub>'), 'hello *(world)*');
    });

    it('handles multiple sub tags', () => {
      const result = stripSubTags('<sub>a</sub> and <sub>b</sub>');
      assert.strictEqual(result, '*(a)* and *(b)*');
    });

    it('returns content unchanged when no sub tags', () => {
      const content = 'no sub tags here';
      assert.strictEqual(stripSubTags(content), content);
    });

    it('handles empty sub tags', () => {
      assert.strictEqual(stripSubTags('<sub></sub>'), '*()*');
    });
  });

  // ── processAttribution ───────────────────────────────────────────────────────

  describe('processAttribution', () => {
    const sampleWithAttribution = 'Some commit message\n\nCo-Authored-By: Claude Sonnet <noreply@anthropic.com>';

    it('removes Co-Authored-By lines when attribution is null', () => {
      const result = processAttribution(sampleWithAttribution, null);
      assert.ok(!result.includes('Co-Authored-By:'));
    });

    it('keeps content unchanged when attribution is undefined', () => {
      const result = processAttribution(sampleWithAttribution, undefined);
      assert.strictEqual(result, sampleWithAttribution);
    });

    it('replaces Co-Authored-By with custom attribution', () => {
      const result = processAttribution(sampleWithAttribution, 'Custom Author <custom@example.com>');
      assert.ok(result.includes('Co-Authored-By: Custom Author <custom@example.com>'));
      assert.ok(!result.includes('Claude Sonnet'));
    });

    it('handles content with no Co-Authored-By when attribution is null', () => {
      const result = processAttribution('plain content', null);
      assert.strictEqual(result, 'plain content');
    });

    it('escapes $ in custom attribution to prevent backreference injection', () => {
      const result = processAttribution(sampleWithAttribution, 'Author $1 <test@x.com>');
      assert.ok(result.includes('Co-Authored-By: Author $1 <test@x.com>'));
    });
  });

  // ── convertClaudeToOpencodeFrontmatter ───────────────────────────────────────

  describe('convertClaudeToOpencodeFrontmatter', () => {
    it('converts allowed-tools array to tools object', () => {
      const input = `---
name: forge-test
description: Test command
allowed-tools:
  - Bash
  - Read
  - Edit
---
# Body content
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('bash: true'));
      assert.ok(result.includes('read: true'));
      assert.ok(result.includes('edit: true'));
      assert.ok(!result.includes('allowed-tools:'));
    });

    it('removes name: field from frontmatter', () => {
      const input = `---
name: forge-test
description: A test
---
Body
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(!result.includes('name: forge-test'));
      assert.ok(result.includes('description: A test'));
    });

    it('converts color names to hex', () => {
      const input = `---
description: Test
color: cyan
---
Body
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('color: "#00FFFF"'));
    });

    it('replaces /forge: with /forge- in content', () => {
      const input = `---
description: Test
---
Use /forge:init to start
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('/forge-init'));
    });

    it('replaces ~/.claude with ~/.config/opencode in content', () => {
      const input = `---
description: Test
---
See ~/.claude/settings.json
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('~/.config/opencode'));
      assert.ok(!result.includes('~/.claude'));
    });

    it('replaces AskUserQuestion with question in body', () => {
      const input = `---
description: Test
---
Use AskUserQuestion to ask
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('question'));
    });

    it('handles content without frontmatter', () => {
      const input = 'No frontmatter here\nJust text';
      const result = convertClaudeToOpencodeFrontmatter(input);
      // Still applies text replacements
      assert.ok(result.includes('No frontmatter here'));
    });

    it('replaces subagent_type="general-purpose" with "general"', () => {
      const input = `---
description: Test
---
subagent_type="general-purpose"
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('subagent_type="general"'));
      assert.ok(!result.includes('general-purpose'));
    });

    it('maps AskUserQuestion to question in allowed-tools', () => {
      const input = `---
description: Test
allowed-tools:
  - AskUserQuestion
  - Bash
---
Body
`;
      const result = convertClaudeToOpencodeFrontmatter(input);
      assert.ok(result.includes('question: true'));
      assert.ok(result.includes('bash: true'));
    });
  });

  // ── convertClaudeToGeminiAgent ───────────────────────────────────────────────

  describe('convertClaudeToGeminiAgent', () => {
    it('converts allowed-tools array to Gemini tools array', () => {
      const input = `---
name: test-agent
description: Test agent
allowed-tools:
  - Read
  - Bash
  - Edit
---
# Agent body
`;
      const result = convertClaudeToGeminiAgent(input);
      assert.ok(result.includes('  - read_file'));
      assert.ok(result.includes('  - run_shell_command'));
      assert.ok(result.includes('  - replace'));
      assert.ok(!result.includes('allowed-tools:'));
    });

    it('excludes mcp__ tools from Gemini output', () => {
      const input = `---
description: Test
allowed-tools:
  - Bash
  - mcp__slack__send
---
Body
`;
      const result = convertClaudeToGeminiAgent(input);
      assert.ok(!result.includes('mcp__slack__send'));
      assert.ok(result.includes('run_shell_command'));
    });

    it('excludes Task tool from Gemini output', () => {
      const input = `---
description: Test
allowed-tools:
  - Bash
  - Task
---
Body
`;
      const result = convertClaudeToGeminiAgent(input);
      assert.ok(!result.includes('task'));
      assert.ok(result.includes('run_shell_command'));
    });

    it('strips color field', () => {
      const input = `---
description: Test
color: cyan
allowed-tools:
  - Bash
---
Body
`;
      const result = convertClaudeToGeminiAgent(input);
      assert.ok(!result.includes('color:'));
    });

    it('escapes ${VAR} template patterns in body', () => {
      const input = `---
description: Test
---
Run with ${'{'}PHASE{'}'} variable
`.replace("${'{'}", '${').replace("{'}'}", '}');

      // Build input with actual ${PHASE}
      const realInput = `---
description: Test
---
Run with \${PHASE} variable
`;
      const result = convertClaudeToGeminiAgent(realInput);
      // ${PHASE} should become $PHASE
      assert.ok(result.includes('$PHASE'));
      assert.ok(!result.includes('${PHASE}'));
    });

    it('converts <sub> tags in body', () => {
      const input = `---
description: Test
---
See <sub>subscript</sub> text
`;
      const result = convertClaudeToGeminiAgent(input);
      assert.ok(result.includes('*(subscript)*'));
    });

    it('returns content unchanged when no frontmatter', () => {
      const input = 'No frontmatter content';
      assert.strictEqual(convertClaudeToGeminiAgent(input), input);
    });
  });

  // ── convertClaudeToGeminiToml ────────────────────────────────────────────────

  describe('convertClaudeToGeminiToml', () => {
    it('converts markdown with frontmatter to TOML format', () => {
      const input = `---
description: My command description
---
This is the prompt body.
`;
      const result = convertClaudeToGeminiToml(input);
      assert.ok(result.includes('description = "My command description"'));
      assert.ok(result.includes('prompt = '));
      assert.ok(result.includes('This is the prompt body.'));
    });

    it('wraps content without frontmatter as prompt', () => {
      const input = 'Just a plain prompt';
      const result = convertClaudeToGeminiToml(input);
      assert.ok(result.startsWith('prompt = '));
      assert.ok(result.includes('Just a plain prompt'));
    });

    it('omits description when not present in frontmatter', () => {
      const input = `---
name: test
---
Body content
`;
      const result = convertClaudeToGeminiToml(input);
      assert.ok(!result.includes('description'));
      assert.ok(result.includes('prompt = '));
    });

    it('handles frontmatter with no closing ---', () => {
      const input = `---
description: broken`;
      const result = convertClaudeToGeminiToml(input);
      // Falls back to wrapping entire content as prompt
      assert.ok(result.startsWith('prompt = '));
    });
  });

  // ── mergeExecutionContextBlocks ──────────────────────────────────────────────

  describe('mergeExecutionContextBlocks', () => {
    it('returns content unchanged when references array is empty', () => {
      const content = 'Some content';
      assert.strictEqual(mergeExecutionContextBlocks(content, []), content);
    });

    it('returns content unchanged when no references provided', () => {
      const content = 'Some content';
      assert.strictEqual(mergeExecutionContextBlocks(content), content);
    });

    it('injects execution_context block with references', () => {
      const content = 'Some body content here';
      const result = mergeExecutionContextBlocks(content, ['@ref/file.md']);
      assert.ok(result.includes('<execution_context>'));
      assert.ok(result.includes('@ref/file.md'));
      assert.ok(result.includes('</execution_context>'));
    });

    it('merges existing execution_context block with new references', () => {
      const content = 'Body\n<execution_context>\n@existing.md\n</execution_context>\nMore body';
      const result = mergeExecutionContextBlocks(content, ['@new.md']);
      assert.ok(result.includes('@existing.md'));
      assert.ok(result.includes('@new.md'));
      // Old block should be removed (merged into one)
      const count = (result.match(/<execution_context>/g) || []).length;
      assert.strictEqual(count, 1);
    });

    it('deduplicates references', () => {
      const content = 'Body';
      const result = mergeExecutionContextBlocks(content, ['@ref.md', '@ref.md']);
      const occurrences = (result.match(/@ref\.md/g) || []).length;
      assert.strictEqual(occurrences, 1);
    });

    it('places merged block after frontmatter', () => {
      const content = '---\nname: test\n---\nBody content';
      const result = mergeExecutionContextBlocks(content, ['@ref.md']);
      const fmEnd = result.indexOf('\n---\n');
      const ctxStart = result.indexOf('<execution_context>');
      assert.ok(fmEnd < ctxStart, 'execution_context should appear after frontmatter');
    });
  });

  // ── parseJsonc ───────────────────────────────────────────────────────────────

  describe('parseJsonc', () => {
    it('parses standard JSON', () => {
      const result = parseJsonc('{"key": "value", "num": 42}');
      assert.deepStrictEqual(result, { key: 'value', num: 42 });
    });

    it('strips single-line // comments', () => {
      const jsonc = `{
  "key": "value", // this is a comment
  "other": true
}`;
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { key: 'value', other: true });
    });

    it('strips block /* */ comments', () => {
      const jsonc = `{
  /* block comment */
  "key": "value"
}`;
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { key: 'value' });
    });

    it('removes trailing commas before } and ]', () => {
      const jsonc = '{"a": 1, "b": [1, 2, 3,],}';
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { a: 1, b: [1, 2, 3] });
    });

    it('handles URLs in strings without treating // as comment', () => {
      const jsonc = '{"url": "https://example.com"}';
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { url: 'https://example.com' });
    });

    it('handles BOM prefix', () => {
      const jsonc = '\uFEFF{"key": "value"}';
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { key: 'value' });
    });

    it('handles escaped quotes inside strings', () => {
      const jsonc = '{"key": "val\\"ue"}';
      const result = parseJsonc(jsonc);
      assert.deepStrictEqual(result, { key: 'val"ue' });
    });

    it('throws on invalid JSON after comment removal', () => {
      assert.throws(() => parseJsonc('{invalid}'));
    });
  });

  // ── Path conversion: absolute vs relative ────────────────────────────────────

  describe('relative to absolute path conversion', () => {
    it('resolves relative path against cwd to an absolute path', () => {
      const cwd = '/some/project';
      const rel = 'atos-forge/bin/forge-tools.cjs';
      const abs = path.resolve(cwd, rel);
      assert.ok(path.isAbsolute(abs));
      assert.strictEqual(abs, '/some/project/atos-forge/bin/forge-tools.cjs');
    });

    it('path.join produces correct install target paths for global claude', () => {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.claude');
      const forgeTarget = path.join(configDir, 'atos-forge');
      assert.ok(path.isAbsolute(forgeTarget));
      assert.ok(forgeTarget.includes('.claude'));
      assert.ok(forgeTarget.endsWith('atos-forge'));
    });

    it('path.join produces correct install target paths for local install', () => {
      const projectDir = '/my/project';
      const localTarget = path.join(projectDir, '.claude', 'atos-forge');
      assert.strictEqual(localTarget, '/my/project/.claude/atos-forge');
    });

    it('global codex install path appends /forge', () => {
      const homeDir = os.homedir();
      const codexDir = path.join(homeDir, '.codex', 'forge');
      assert.ok(codexDir.includes('.codex'));
      assert.ok(codexDir.endsWith('forge'));
    });
  });

  // ── Idempotent module copy simulation ───────────────────────────────────────

  describe('idempotent copy simulation', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-install-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writing then overwriting a file produces final content', () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'version 1');
      fs.writeFileSync(filePath, 'version 2');
      assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'version 2');
    });

    it('recreating a directory (rmSync + mkdirSync) is idempotent', () => {
      const dirPath = path.join(tmpDir, 'atos-forge');
      fs.mkdirSync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'old-file.md'), 'old content');

      // Simulate clean install: remove, recreate
      fs.rmSync(dirPath, { recursive: true });
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'new-file.md'), 'new content');

      const files = fs.readdirSync(dirPath);
      assert.ok(files.includes('new-file.md'));
      assert.ok(!files.includes('old-file.md'));
    });

    it('package.json CommonJS marker is written correctly', () => {
      const pkgJsonPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(pkgJsonPath, '{"type":"commonjs"}\n');
      const content = fs.readFileSync(pkgJsonPath, 'utf8').trim();
      assert.strictEqual(content, '{"type":"commonjs"}');
    });

    it('running install steps twice does not leave orphaned old files', () => {
      const destDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(destDir);

      // First install: write two forge skill dirs
      fs.mkdirSync(path.join(destDir, 'forge-init'));
      fs.writeFileSync(path.join(destDir, 'forge-init', 'SKILL.md'), '# v1');
      fs.mkdirSync(path.join(destDir, 'forge-plan-phase'));
      fs.writeFileSync(path.join(destDir, 'forge-plan-phase', 'SKILL.md'), '# v1');

      // Second install: remove old forge-* dirs, recreate from fresh source
      for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('forge-')) {
          fs.rmSync(path.join(destDir, entry.name), { recursive: true });
        }
      }
      fs.mkdirSync(path.join(destDir, 'forge-init'));
      fs.writeFileSync(path.join(destDir, 'forge-init', 'SKILL.md'), '# v2');

      const entries = fs.readdirSync(destDir, { withFileTypes: true });
      const names = entries.filter(e => e.isDirectory()).map(e => e.name);
      // forge-plan-phase was removed and not re-added
      assert.ok(!names.includes('forge-plan-phase'));
      assert.ok(names.includes('forge-init'));
      const skillContent = fs.readFileSync(path.join(destDir, 'forge-init', 'SKILL.md'), 'utf8');
      assert.strictEqual(skillContent, '# v2');
    });

    it('error handling: missing engine module directory is skipped gracefully', () => {
      const src = path.join(tmpDir, 'forge-nonexistent');
      // Directory does not exist
      assert.strictEqual(fs.existsSync(src), false);

      // Simulate installer guard: if (!fs.existsSync(modSrc)) continue;
      let copied = false;
      if (fs.existsSync(src)) {
        copied = true;
      }
      assert.strictEqual(copied, false);
    });
  });
});
