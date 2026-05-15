'use strict';

/**
 * tests/e2e/project5.polyglot-ops.cjs
 *
 * Project 5: Polyglot ops repo.
 * Exercises P7 (AGENTS.md generator) and P8 (MCP server, skills marketplace,
 * runtime adapters). This is the cross-cutting ecosystem test — it spins up
 * the MCP server, lists/calls tools, installs a local skill, and renders
 * runtime invocations for all 4 supported CLIs.
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

function run() {
  const ledger = h.newLedger('project5-polyglot-ops');
  const root = h.createProject('polyglot-ops');
  try {
    // 1) Seed mixed-language ops repo so AGENTS.md has something to describe.
    h.writeFile(root, 'src/index.js',
      "'use strict';\nmodule.exports = { run: () => 'ok' };\n");
    h.writeFile(root, 'tools/migrate.py',
      "def migrate(args):\n    return {'ok': True, 'rows': len(args)}\n");
    h.writeFile(root, 'infra/deploy.sh',
      "#!/usr/bin/env bash\necho deploy\n");
    h.gitInit(root);

    // 2) AGENTS.md generator (P7 / 4.4.6).
    const genResult = h.runForge(root, ['agents-md', 'generate']);
    h.assert(genResult.code === 0,
      `agents-md generate failed: ${genResult.stderr}`);
    h.assert(h.exists(root, 'AGENTS.md'),
      'AGENTS.md not written');
    const md = h.readFile(root, 'AGENTS.md');
    h.assert(md && md.length > 200, `AGENTS.md too short (${md && md.length})`);
    h.assert(md.includes('polyglot-ops'),
      'AGENTS.md missing project name');
    h.record(ledger, 'agents-md:generate', 'pass',
      `bytes=${md.length}`);

    // 3) agents-md check: should pass right after generate.
    const checkOk = h.runForge(root, ['agents-md', 'check']);
    h.assert(checkOk.code === 0,
      `agents-md check after generate failed: ${checkOk.stdout}|${checkOk.stderr}`);
    h.record(ledger, 'agents-md:check-after-generate', 'pass');

    // 4) agents-md diff: drift detection. We tamper a non-tail (generated)
    //    section and expect non-zero exit.
    h.writeFile(root, 'AGENTS.md', md.replace('polyglot-ops', 'tampered-name'));
    const diff = h.runForge(root, ['agents-md', 'diff']);
    h.assert(diff.code !== 0,
      'agents-md diff should report drift on tampered file');
    h.record(ledger, 'agents-md:diff-detects-drift', 'pass');

    // Restore AGENTS.md for downstream tests.
    h.runForge(root, ['agents-md', 'generate']);

    // 5) Runtime adapters (P8 / 4.5.3). We list and ensure all four
    //    canonical runtimes are present.
    const listRes = h.runForge(root, ['runtimes', 'list']);
    h.assert(listRes.code === 0,
      `runtimes list failed: ${listRes.stderr}`);
    const runtimes = listRes.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    for (const r of ['claude-code', 'codex', 'openhands', 'gemini-cli']) {
      h.assert(runtimes.includes(r),
        `runtime ${r} missing from list (got: ${runtimes.join(', ')})`);
    }
    h.record(ledger, 'runtimes:list-includes-all-4', 'pass',
      `runtimes=${runtimes.length}`);

    // 6) Runtime adapter: claude-code shape. We render flags and verify the
    //    args include the canonical Claude Code shape.
    const claudeFlags = h.runForge(root, ['runtimes', 'flags', 'claude-code',
      'do the thing', '--tools', 'Bash,Read,Write']);
    h.assert(claudeFlags.code === 0,
      `claude-code flags failed: ${claudeFlags.stderr}`);
    const claudeDoc = JSON.parse(claudeFlags.stdout);
    h.assert(Array.isArray(claudeDoc.args) && claudeDoc.args.includes('--print'),
      'claude args missing --print');
    h.assert(claudeDoc.args.includes('--allowedTools'),
      'claude args missing --allowedTools');
    h.assert(claudeDoc.args.includes('Bash,Read,Write'),
      'claude args missing the requested tool list');
    h.record(ledger, 'runtimes:claude-code-shape', 'pass');

    // 7) Runtime adapter: codex shape (exec mode, --full-auto).
    const codexFlags = h.runForge(root, ['runtimes', 'flags', 'codex', 'do the thing']);
    h.assert(codexFlags.code === 0, `codex flags failed: ${codexFlags.stderr}`);
    const codexDoc = JSON.parse(codexFlags.stdout);
    h.assert(codexDoc.args[0] === 'exec' && codexDoc.args.includes('--full-auto'),
      'codex args missing exec --full-auto');
    h.assert(codexDoc.stdin === 'do the thing',
      'codex should pipe prompt via stdin');
    h.record(ledger, 'runtimes:codex-shape', 'pass');

    // 8) Runtime adapter: openhands shape (--no-banner, --allowed-tools).
    const ohFlags = h.runForge(root, ['runtimes', 'flags', 'openhands',
      'do the thing', '--tools', 'Bash,Read']);
    h.assert(ohFlags.code === 0, `openhands flags failed: ${ohFlags.stderr}`);
    const ohDoc = JSON.parse(ohFlags.stdout);
    h.assert(ohDoc.args.includes('--no-banner'),
      'openhands args missing --no-banner');
    h.assert(ohDoc.args.includes('--allowed-tools'),
      'openhands args missing --allowed-tools');
    h.record(ledger, 'runtimes:openhands-shape', 'pass');

    // 9) Runtime adapter: gemini-cli shape (--prompt + --quiet).
    const geminiFlags = h.runForge(root, ['runtimes', 'flags', 'gemini-cli',
      'do the thing']);
    h.assert(geminiFlags.code === 0, `gemini flags failed: ${geminiFlags.stderr}`);
    const geminiDoc = JSON.parse(geminiFlags.stdout);
    h.assert(geminiDoc.args.includes('--prompt') || geminiDoc.args.includes('--quiet'),
      'gemini args missing --prompt/--quiet');
    h.record(ledger, 'runtimes:gemini-shape', 'pass');

    // 10) MCP server: list resources & tools.
    const mcpRes = h.runForge(root, ['mcp', 'list']);
    h.assert(mcpRes.code === 0, `mcp list failed: ${mcpRes.stderr}`);
    h.assert(mcpRes.stdout.includes('forge://graph/overview'),
      'mcp list missing graph overview resource');
    h.assert(mcpRes.stdout.includes('forge://session/ledger'),
      'mcp list missing session ledger resource');
    h.record(ledger, 'mcp:resources-list', 'pass',
      `resources=${mcpRes.stdout.trim().split('\n').length}`);

    const mcpTools = h.runForge(root, ['mcp', 'tools']);
    h.assert(mcpTools.code === 0, `mcp tools failed: ${mcpTools.stderr}`);
    const tools = mcpTools.stdout.trim().split('\n').filter(Boolean);
    h.assert(tools.length >= 5,
      `mcp tools list too short (${tools.length}): ${mcpTools.stdout}`);
    h.record(ledger, 'mcp:tools-list', 'pass', `tools=${tools.length}`);

    // 11) Skills marketplace (P8 / 4.5.2): install a local skill via file: ref.
    const skillSrc = path.join(root, 'local-skill');
    fs.mkdirSync(skillSrc, { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'skill.json'), JSON.stringify({
      id: 'forge-test-skill',
      name: 'Forge Test Skill',
      version: '0.0.1',
      description: 'E2E-installed skill for project5',
    }, null, 2));
    fs.writeFileSync(path.join(skillSrc, 'README.md'), '# test skill\n');

    const skillsAdd = h.runForge(root, ['skills', 'add', `file:${skillSrc}`]);
    h.assert(skillsAdd.code === 0,
      `skills add failed: ${skillsAdd.stderr || skillsAdd.stdout}`);
    h.assert(skillsAdd.stdout.includes('installed:'),
      'skills add did not report install');
    h.record(ledger, 'skills:add-file-ref', 'pass', skillsAdd.stdout.trim());

    // 12) Skills list: should show the installed skill.
    const skillsList = h.runForge(root, ['skills', 'list']);
    h.assert(skillsList.code === 0, `skills list failed: ${skillsList.stderr}`);
    h.assert(skillsList.stdout.includes('forge-test-skill'),
      'skills list did not include freshly added skill');
    h.record(ledger, 'skills:list-shows-installed', 'pass');

    // 13) Skills info: should return the manifest JSON.
    const skillsInfo = h.runForge(root, ['skills', 'info', 'forge-test-skill']);
    h.assert(skillsInfo.code === 0, `skills info failed: ${skillsInfo.stderr}`);
    const infoDoc = JSON.parse(skillsInfo.stdout);
    h.assert(infoDoc.id === 'forge-test-skill'
        && infoDoc.manifest && infoDoc.manifest.version === '0.0.1',
      `skills info wrong shape: ${skillsInfo.stdout}`);
    h.record(ledger, 'skills:info-roundtrips', 'pass');

    // 14) Skills remove: should remove the skill from .forge/skills/.
    const skillsRm = h.runForge(root, ['skills', 'remove', 'forge-test-skill']);
    h.assert(skillsRm.code === 0, `skills remove failed: ${skillsRm.stderr}`);
    h.assert(skillsRm.stdout.includes('removed:'),
      'skills remove did not report removal');
    const installed = path.join(root, '.forge', 'skills', 'forge-test-skill');
    h.assert(!fs.existsSync(installed),
      'skills remove did not delete the install dir');
    h.record(ledger, 'skills:remove-cleans-up', 'pass');

  } catch (err) {
    h.record(ledger, 'fatal', 'fail', String(err && err.message || err));
  } finally {
    h.finalize(ledger);
    h.writeReport(ledger);
    h.destroyProject(root);
  }
  return ledger;
}

if (require.main === module) {
  const l = run();
  process.exitCode = l.fail === 0 ? 0 : 1;
}

module.exports = { run };
