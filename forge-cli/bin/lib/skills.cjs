'use strict';

/**
 * forge-cli/bin/lib/skills.cjs  (P8 / 4.5.4)
 *
 * Skill marketplace adapter.
 *
 * Subcommands:
 *   skills list                      — list installed skills (from `.forge/skills/`).
 *   skills add <ref>                 — install a skill into `.forge/skills/<id>/`.
 *   skills remove <id>               — uninstall a skill.
 *   skills info <id>                 — show metadata for one skill.
 *
 * `<ref>` may be:
 *   - `npm:<package>`     — install via `npm pack` into the skills dir.
 *   - `git:<url>[#ref]`   — shallow clone.
 *   - `file:<path>`       — copy a local directory.
 *   - `<package>`         — shorthand for `npm:<package>`.
 *
 * A skill is just a directory containing `skill.json` (or `skill.yaml`) plus
 * any files referenced from it. We do not execute skills here — runtimes
 * surface them through their own mechanisms (Claude Code reads ~/.claude/agents,
 * OpenHands reads .openhands/skills, etc.). The forge-agents/skill-wrapper.js
 * exposes them as agent capabilities downstream.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function _skillsDir(cwd) {
  return path.join(cwd, '.forge', 'skills');
}

function _ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function _safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'skill';
}

function _readManifest(dir) {
  for (const name of ['skill.json', 'skill.yaml', 'skill.yml']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try {
        const txt = fs.readFileSync(p, 'utf8');
        if (name.endsWith('.json')) return JSON.parse(txt);
        return _parseYamlMinimal(txt);
      } catch { /* ignore */ }
    }
  }
  return null;
}

function _parseYamlMinimal(txt) {
  // Tiny key:value YAML parser for `name`, `version`, `description`.
  const out = {};
  for (const line of String(txt).split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function listSkills(cwd) {
  const dir = _skillsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => !n.startsWith('.'))
    .map(n => {
      const sd = path.join(dir, n);
      const manifest = _readManifest(sd) || {};
      return {
        id: n,
        path: sd,
        name: manifest.name || n,
        version: manifest.version || '',
        description: manifest.description || '',
      };
    });
}

function _addFromNpm(cwd, pkg) {
  const dir = _skillsDir(cwd);
  _ensureDir(dir);
  const id = _safeId(pkg.replace(/^@/, '').replace(/\//g, '_'));
  const target = path.join(dir, id);
  _ensureDir(target);
  // `npm pack` emits a tarball into cwd; do it in a tmp dir then extract.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-skill-'));
  try {
    execFileSync('npm', ['pack', pkg, '--silent'], {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tarball = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    if (!tarball) throw new Error(`npm pack produced no tarball for ${pkg}`);
    execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', target, '--strip-components=1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return { id, path: target };
}

function _addFromGit(cwd, ref) {
  const dir = _skillsDir(cwd);
  _ensureDir(dir);
  // ref form: `<url>[#<branch>]`
  const [url, branch] = String(ref).split('#');
  const slug = path.basename(url, '.git');
  const id = _safeId(slug);
  const target = path.join(dir, id);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  const args = ['clone', '--depth', '1'];
  if (branch) args.push('--branch', branch);
  args.push(url, target);
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  try { fs.rmSync(path.join(target, '.git'), { recursive: true, force: true }); }
  catch { /* ignore */ }
  return { id, path: target };
}

function _addFromFile(cwd, src) {
  const dir = _skillsDir(cwd);
  _ensureDir(dir);
  const abs = path.isAbsolute(src) ? src : path.resolve(cwd, src);
  if (!fs.existsSync(abs)) throw new Error(`file:${src} does not exist`);
  // Prefer the manifest id (skill.json/skill.yaml) so the on-disk name
  // matches what the user declared. Fall back to the directory basename.
  const manifest = _readManifest(abs) || {};
  const id = _safeId(manifest.id || path.basename(abs));
  const target = path.join(dir, id);
  _ensureDir(target);
  _copyDir(abs, target);
  return { id, path: target };
}

function _copyDir(src, dst) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      _ensureDir(d);
      _copyDir(s, d);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function addSkill(cwd, ref) {
  if (!ref) throw new Error('skills add: missing <ref>');
  if (ref.startsWith('npm:')) return _addFromNpm(cwd, ref.slice(4));
  if (ref.startsWith('git:')) return _addFromGit(cwd, ref.slice(4));
  if (ref.startsWith('file:')) return _addFromFile(cwd, ref.slice(5));
  // Bare package name → assume npm.
  return _addFromNpm(cwd, ref);
}

function removeSkill(cwd, id) {
  if (!id) throw new Error('skills remove: missing <id>');
  const safe = _safeId(id);
  const target = path.join(_skillsDir(cwd), safe);
  if (!fs.existsSync(target)) return { id: safe, removed: false };
  fs.rmSync(target, { recursive: true, force: true });
  return { id: safe, removed: true };
}

function infoSkill(cwd, id) {
  if (!id) throw new Error('skills info: missing <id>');
  const safe = _safeId(id);
  const target = path.join(_skillsDir(cwd), safe);
  if (!fs.existsSync(target)) return null;
  return { id: safe, path: target, manifest: _readManifest(target) || {} };
}

function handleCli(cwd, argv) {
  const sub = argv[0] || 'list';
  if (sub === 'list') {
    const items = listSkills(cwd);
    if (items.length === 0) { process.stdout.write('(no skills installed)\n'); return; }
    for (const s of items) {
      process.stdout.write(`${s.id}\t${s.version || '-'}\t${s.description || s.name}\n`);
    }
    return;
  }
  if (sub === 'add') {
    const ref = argv[1];
    try {
      const res = addSkill(cwd, ref);
      process.stdout.write(`installed: ${res.id} → ${res.path}\n`);
    } catch (err) {
      process.stderr.write(`skills add: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }
  if (sub === 'remove' || sub === 'rm') {
    const id = argv[1];
    try {
      const res = removeSkill(cwd, id);
      process.stdout.write(res.removed ? `removed: ${res.id}\n` : `not installed: ${res.id}\n`);
    } catch (err) {
      process.stderr.write(`skills remove: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }
  if (sub === 'info') {
    const id = argv[1];
    const info = infoSkill(cwd, id);
    if (!info) { process.stderr.write(`skill not found: ${id}\n`); process.exit(1); }
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return;
  }
  process.stderr.write(`skills: unknown subcommand '${sub}'.\n`);
  process.exit(2);
}

module.exports = {
  handleCli,
  listSkills, addSkill, removeSkill, infoSkill,
};
