'use strict';

/**
 * forge-agents/skill-wrapper.js  (P8 / 4.5.4)
 *
 * Bridges `.forge/skills/<id>/` directories into the agent capability layer.
 * When the dynamic agent factory builds an agent, it can call
 * `listSkillsForAgent(cwd, archetype)` to discover skills tagged for that
 * archetype and inject the corresponding paths / prompts.
 */

const fs = require('fs');
const path = require('path');

function _readManifest(dir) {
  for (const name of ['skill.json', 'skill.yaml', 'skill.yml']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try {
        const txt = fs.readFileSync(p, 'utf8');
        if (name.endsWith('.json')) return JSON.parse(txt);
        const out = {};
        for (const line of txt.split('\n')) {
          const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
          if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
        return out;
      } catch { /* ignore */ }
    }
  }
  return null;
}

function listSkills(cwd) {
  const dir = path.join(cwd, '.forge', 'skills');
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
        archetypes: Array.isArray(manifest.archetypes) ? manifest.archetypes : [],
        capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      };
    });
}

function listSkillsForAgent(cwd, archetype) {
  const all = listSkills(cwd);
  if (!archetype) return all;
  return all.filter(s =>
    !s.archetypes.length || s.archetypes.includes(archetype)
  );
}

function buildSkillPromptSection(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';
  const lines = ['## Available skills', ''];
  for (const s of skills) {
    lines.push(`- **${s.name}** (${s.id})${s.description ? ` — ${s.description}` : ''}`);
    lines.push(`  - path: \`${s.path}\``);
    if (s.capabilities.length) {
      lines.push(`  - capabilities: ${s.capabilities.join(', ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  listSkills,
  listSkillsForAgent,
  buildSkillPromptSection,
};
