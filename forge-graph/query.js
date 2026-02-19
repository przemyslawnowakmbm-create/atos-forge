#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// Graph Query Engine
// ============================================================

class GraphQuery {
  /**
   * @param {string} dbPath - Path to the SQLite database.
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Open the database connection.
   */
  open() {
    if (this.db) return this;
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Database not found: ${this.dbPath}. Run 'forge-graph build' first.`);
    }
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath, { readonly: true });
    this.db.pragma('journal_mode = WAL');
    return this;
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ============================================================
  // File Queries
  // ============================================================

  /**
   * Get all files, optionally filtered.
   * @param {{ module?: string, language?: string, isTest?: boolean, limit?: number }} opts
   */
  files(opts = {}) {
    this.open();
    let sql = 'SELECT * FROM files WHERE 1=1';
    const params = [];

    if (opts.module) { sql += ' AND module = ?'; params.push(opts.module); }
    if (opts.language) { sql += ' AND language = ?'; params.push(opts.language); }
    if (opts.isTest !== undefined) { sql += ' AND is_test = ?'; params.push(opts.isTest ? 1 : 0); }

    sql += ' ORDER BY loc DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get a single file by path.
   */
  file(filePath) {
    this.open();
    return this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
  }

  /**
   * Get the most complex files.
   * @param {number} [limit=20]
   */
  hotspots(limit = 20) {
    this.open();
    return this.db.prepare(`
      SELECT f.path, f.module, f.language, f.loc, f.complexity_score,
             COALESCE(cf.changes_30d, 0) as changes_30d,
             f.complexity_score * (1 + COALESCE(cf.changes_30d, 0) * 0.1) as risk_score
      FROM files f
      LEFT JOIN change_frequency cf ON f.path = cf.file
      WHERE f.is_test = 0 AND f.is_config = 0
      ORDER BY risk_score DESC
      LIMIT ?
    `).all(limit);
  }

  // ============================================================
  // Symbol Queries
  // ============================================================

  /**
   * Search for symbols by name (supports SQL LIKE patterns).
   * @param {string} pattern
   * @param {{ kind?: string, exported?: boolean, limit?: number }} opts
   */
  symbols(pattern, opts = {}) {
    this.open();
    let sql = 'SELECT s.*, f.module FROM symbols s JOIN files f ON s.file = f.path WHERE s.name LIKE ?';
    const params = [pattern];

    if (opts.kind) { sql += ' AND s.kind = ?'; params.push(opts.kind); }
    if (opts.exported !== undefined) { sql += ' AND s.exported = ?'; params.push(opts.exported ? 1 : 0); }

    sql += ' ORDER BY s.name';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get all symbols in a file.
   */
  symbolsInFile(filePath) {
    this.open();
    return this.db.prepare('SELECT * FROM symbols WHERE file = ? ORDER BY line_start').all(filePath);
  }

  /**
   * Find exported symbols (public API) of a module.
   */
  moduleAPI(moduleName) {
    this.open();
    return this.db.prepare(`
      SELECT s.name, s.kind, s.file, s.signature, s.line_start
      FROM symbols s
      JOIN files f ON s.file = f.path
      WHERE f.module = ? AND s.exported = 1
      ORDER BY s.kind, s.name
    `).all(moduleName);
  }

  // ============================================================
  // Dependency Queries
  // ============================================================

  /**
   * Get all imports for a file.
   */
  importsOf(filePath) {
    this.open();
    return this.db.prepare(`
      SELECT target_file, import_name, import_type
      FROM dependencies
      WHERE source_file = ?
      ORDER BY target_file
    `).all(filePath);
  }

  /**
   * Get all files that import a given file (reverse dependencies).
   */
  importedBy(filePath) {
    this.open();
    return this.db.prepare(`
      SELECT source_file, import_name, import_type
      FROM dependencies
      WHERE target_file = ?
      ORDER BY source_file
    `).all(filePath);
  }

  /**
   * Find dependency chains (transitive dependencies) from a file up to a given depth.
   * @param {string} filePath
   * @param {number} [maxDepth=3]
   */
  dependencyChain(filePath, maxDepth = 3) {
    this.open();
    const visited = new Set();
    const chain = [];

    const getImports = this.db.prepare('SELECT target_file FROM dependencies WHERE source_file = ?');

    const walk = (fp, depth) => {
      if (depth > maxDepth || visited.has(fp)) return;
      visited.add(fp);
      const imports = getImports.all(fp);
      for (const imp of imports) {
        chain.push({ from: fp, to: imp.target_file, depth });
        walk(imp.target_file, depth + 1);
      }
    };

    walk(filePath, 1);
    return chain;
  }

  /**
   * Find circular dependencies.
   * @returns {Array<string[]>} - Array of cycles (each cycle is an array of file paths).
   */
  circularDependencies() {
    this.open();
    const deps = this.db.prepare('SELECT source_file, target_file FROM dependencies').all();

    // Build adjacency list
    const graph = new Map();
    for (const dep of deps) {
      if (!graph.has(dep.source_file)) graph.set(dep.source_file, []);
      graph.get(dep.source_file).push(dep.target_file);
    }

    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    const pathStack = [];

    const dfs = (node) => {
      visited.add(node);
      recStack.add(node);
      pathStack.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          // Found cycle — extract it
          const cycleStart = pathStack.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push(pathStack.slice(cycleStart).concat(neighbor));
          }
        }
      }

      pathStack.pop();
      recStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) dfs(node);
    }

    return cycles;
  }

  // ============================================================
  // Module Queries
  // ============================================================

  /**
   * List all modules with their stats.
   */
  modules() {
    this.open();
    return this.db.prepare(`
      SELECT m.*,
             GROUP_CONCAT(DISTINCT mc.capability) as capabilities
      FROM modules m
      LEFT JOIN module_capabilities mc ON m.name = mc.module_name AND mc.confidence >= 0.3
      GROUP BY m.name
      ORDER BY m.file_count DESC
    `).all();
  }

  /**
   * Get detailed module info with capabilities, dependencies, and files.
   */
  moduleDetail(moduleName) {
    this.open();
    const mod = this.db.prepare('SELECT * FROM modules WHERE name = ?').get(moduleName);
    if (!mod) return null;

    const files = this.db.prepare('SELECT path, language, loc, complexity_score FROM files WHERE module = ? ORDER BY loc DESC').all(moduleName);
    const capabilities = this.db.prepare('SELECT capability, confidence, evidence FROM module_capabilities WHERE module_name = ? ORDER BY confidence DESC').all(moduleName);
    const dependsOn = this.db.prepare('SELECT target_module, edge_count FROM module_dependencies WHERE source_module = ? ORDER BY edge_count DESC').all(moduleName);
    const dependedOnBy = this.db.prepare('SELECT source_module, edge_count FROM module_dependencies WHERE target_module = ? ORDER BY edge_count DESC').all(moduleName);

    return { ...mod, files, capabilities, dependsOn, dependedOnBy };
  }

  /**
   * Get module dependency graph (for visualization).
   */
  moduleDependencyGraph() {
    this.open();
    const nodes = this.db.prepare('SELECT name, file_count, stability FROM modules').all();
    const edges = this.db.prepare('SELECT source_module, target_module, edge_count FROM module_dependencies').all();
    return { nodes, edges };
  }

  // ============================================================
  // Interface & Change Queries
  // ============================================================

  /**
   * Get the public interfaces (exported symbols) most consumed by other files.
   * @param {number} [limit=20]
   */
  mostUsedInterfaces(limit = 20) {
    this.open();
    return this.db.prepare(`
      SELECT i.name, i.kind, i.file, i.consumer_count, i.contract_hash,
             f.module
      FROM interfaces i
      JOIN files f ON i.file = f.path
      ORDER BY i.consumer_count DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Get files with the highest churn (most changes in 30 days).
   * @param {number} [limit=20]
   */
  highChurn(limit = 20) {
    this.open();
    return this.db.prepare(`
      SELECT cf.*, f.module, f.language, f.loc
      FROM change_frequency cf
      JOIN files f ON cf.file = f.path
      ORDER BY cf.changes_30d DESC
      LIMIT ?
    `).all(limit);
  }

  // ============================================================
  // Capability Queries
  // ============================================================

  /**
   * Get all capabilities detected across modules.
   */
  capabilities() {
    this.open();
    return this.db.prepare(`
      SELECT mc.capability, mc.module_name, mc.confidence, mc.evidence
      FROM module_capabilities mc
      WHERE mc.confidence >= 0.2
      ORDER BY mc.capability, mc.confidence DESC
    `).all();
  }

  /**
   * Find modules that provide a specific capability.
   */
  capabilityProviders(capability) {
    this.open();
    return this.db.prepare(`
      SELECT mc.module_name, mc.confidence, mc.evidence
      FROM module_capabilities mc
      WHERE mc.capability = ? AND mc.confidence >= 0.2
      ORDER BY mc.confidence DESC
    `).all(capability);
  }

  // ============================================================
  // Warning & Learning Queries
  // ============================================================

  /**
   * Get warnings, optionally filtered by severity.
   */
  warnings(opts = {}) {
    this.open();
    let sql = 'SELECT * FROM warnings WHERE 1=1';
    const params = [];

    if (opts.module) { sql += ' AND module = ?'; params.push(opts.module); }
    if (opts.severity) { sql += ' AND severity = ?'; params.push(opts.severity); }

    sql += ' ORDER BY created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get agent learnings.
   */
  learnings(opts = {}) {
    this.open();
    let sql = 'SELECT * FROM agent_learnings WHERE 1=1';
    const params = [];

    if (opts.module) { sql += ' AND module = ?'; params.push(opts.module); }
    if (opts.type) { sql += ' AND learning_type = ?'; params.push(opts.type); }

    sql += ' ORDER BY created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

    return this.db.prepare(sql).all(...params);
  }

  // ============================================================
  // Write Operations (for agents)
  // ============================================================

  /**
   * Record a warning.
   */
  addWarning(module, file, text, severity = 'info', source = 'agent') {
    this.open();
    // Re-open as read-write for mutations
    if (this.db) this.db.close();
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.prepare(`
      INSERT INTO warnings (module, file, warning_text, severity, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(module, file, text, severity, source);
  }

  /**
   * Record an agent learning.
   */
  addLearning(agentId, module, type, content) {
    this.open();
    if (this.db) this.db.close();
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.prepare(`
      INSERT INTO agent_learnings (agent_id, module, learning_type, content)
      VALUES (?, ?, ?, ?)
    `).run(agentId, module, type, content);
  }

  // ============================================================
  // Metadata
  // ============================================================

  /**
   * Get build metadata.
   */
  meta() {
    this.open();
    const rows = this.db.prepare('SELECT key, value FROM graph_meta').all();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ============================================================
  // Summary / Overview
  // ============================================================

  /**
   * Generate a high-level summary of the repository.
   */
  summary() {
    this.open();
    const meta = this.meta();
    const modules = this.modules();
    const langStats = this.db.prepare(`
      SELECT language, COUNT(*) as files, SUM(loc) as total_loc
      FROM files
      GROUP BY language
      ORDER BY total_loc DESC
    `).all();
    const topComplexity = this.hotspots(10);
    const topChurn = this.highChurn(10);
    const capabilities = this.capabilities();

    // Group capabilities by name
    const capMap = new Map();
    for (const cap of capabilities) {
      if (!capMap.has(cap.capability)) capMap.set(cap.capability, []);
      capMap.get(cap.capability).push(cap.module_name);
    }

    return {
      meta,
      languages: langStats,
      modules: modules.map(m => ({
        name: m.name,
        files: m.file_count,
        stability: m.stability,
        capabilities: m.capabilities ? m.capabilities.split(',') : [],
      })),
      hotspots: topComplexity,
      highChurn: topChurn,
      capabilities: Object.fromEntries(capMap),
    };
  }
}

// ============================================================
// CLI Interface
// ============================================================

function printHelp() {
  console.log(`
  A-Forge Graph Engine — Query Interface

  Usage: forge-graph <command> [options]

  Commands:
    summary                   High-level repository overview
    files [--module M] [--lang L]  List files
    file <path>               File details with symbols and dependencies
    symbols <pattern>         Search symbols (SQL LIKE pattern, e.g., "%User%")
    module <name>             Detailed module info
    modules                   List all modules
    hotspots [--limit N]      Files ranked by risk (complexity x churn)
    churn [--limit N]         Files with highest change frequency
    imports <path>            What a file imports
    imported-by <path>        What imports a given file
    dep-chain <path> [--depth N]  Transitive dependency chain
    circles                   Find circular dependencies
    capabilities              List all detected capabilities
    capability <name>         Find modules providing a capability
    interfaces [--limit N]    Most-consumed public interfaces
    warnings [--severity S]   List warnings
    meta                      Build metadata

  Options:
    --db <path>    Path to graph database (default: .forge/graph.db)
    --json         Output as JSON
    --help         Show this help
`);
}

function formatTable(rows, columns) {
  if (rows.length === 0) {
    console.log('  (no results)');
    return;
  }

  // Calculate column widths
  const widths = {};
  for (const col of columns) {
    widths[col.key] = col.label.length;
    for (const row of rows) {
      const val = String(row[col.key] ?? '');
      widths[col.key] = Math.max(widths[col.key], val.length);
    }
    widths[col.key] = Math.min(widths[col.key], col.maxWidth || 60);
  }

  // Header
  const header = columns.map(col => col.label.padEnd(widths[col.key])).join('  ');
  console.log(`  ${header}`);
  console.log(`  ${columns.map(col => '─'.repeat(widths[col.key])).join('  ')}`);

  // Rows
  for (const row of rows) {
    const line = columns.map(col => {
      let val = String(row[col.key] ?? '');
      if (val.length > (col.maxWidth || 60)) val = val.slice(0, (col.maxWidth || 60) - 3) + '...';
      return val.padEnd(widths[col.key]);
    }).join('  ');
    console.log(`  ${line}`);
  }
}

function run() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const jsonMode = args.includes('--json');
  const dbPath = args.includes('--db')
    ? args[args.indexOf('--db') + 1]
    : path.join(process.cwd(), '.forge', 'graph.db');

  const getArg = (flag, defaultVal) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : defaultVal;
  };

  const q = new GraphQuery(dbPath);

  try {
    q.open();
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }

  try {
    let result;

    switch (command) {
      case 'summary': {
        result = q.summary();
        if (jsonMode) break;

        const s = result;
        console.log(`\n  A-Forge Code Graph — Repository Summary\n`);
        console.log(`  Built: ${s.meta.built_at || s.meta.updated_at || 'unknown'}`);
        console.log(`  Files: ${s.meta.file_count} | Symbols: ${s.meta.symbol_count} | Dependencies: ${s.meta.dependency_count} | Modules: ${s.meta.module_count}\n`);

        console.log('  Languages:');
        for (const lang of s.languages) {
          console.log(`    ${lang.language.padEnd(15)} ${String(lang.files).padStart(5)} files  ${String(lang.total_loc).padStart(8)} LOC`);
        }

        console.log('\n  Modules:');
        for (const mod of s.modules) {
          const caps = mod.capabilities.length > 0 ? ` [${mod.capabilities.join(', ')}]` : '';
          console.log(`    ${mod.name.padEnd(25)} ${String(mod.files).padStart(4)} files  stability=${mod.stability}${caps}`);
        }

        if (s.hotspots.length > 0) {
          console.log('\n  Top Risk Hotspots:');
          formatTable(s.hotspots.slice(0, 5), [
            { key: 'path', label: 'File', maxWidth: 50 },
            { key: 'loc', label: 'LOC' },
            { key: 'complexity_score', label: 'Complexity' },
            { key: 'changes_30d', label: 'Changes(30d)' },
            { key: 'risk_score', label: 'Risk' },
          ]);
        }

        if (Object.keys(s.capabilities).length > 0) {
          console.log('\n  Capabilities:');
          for (const [cap, mods] of Object.entries(s.capabilities)) {
            console.log(`    ${cap.padEnd(25)} ${mods.join(', ')}`);
          }
        }

        console.log('');
        q.close();
        return;
      }

      case 'files': {
        result = q.files({
          module: getArg('--module'),
          language: getArg('--lang'),
          isTest: args.includes('--tests') ? true : args.includes('--no-tests') ? false : undefined,
          limit: parseInt(getArg('--limit', '50')),
        });
        if (!jsonMode) {
          formatTable(result, [
            { key: 'path', label: 'Path', maxWidth: 55 },
            { key: 'module', label: 'Module', maxWidth: 20 },
            { key: 'language', label: 'Lang' },
            { key: 'loc', label: 'LOC' },
            { key: 'complexity_score', label: 'Complexity' },
          ]);
        }
        break;
      }

      case 'file': {
        const filePath = args[1];
        if (!filePath) { console.error('  Error: file path required'); process.exit(1); }
        const fileInfo = q.file(filePath);
        if (!fileInfo) { console.error(`  Error: file not found: ${filePath}`); process.exit(1); }

        const syms = q.symbolsInFile(filePath);
        const imports = q.importsOf(filePath);
        const importers = q.importedBy(filePath);

        result = { ...fileInfo, symbols: syms, imports, importedBy: importers };

        if (!jsonMode) {
          console.log(`\n  File: ${fileInfo.path}`);
          console.log(`  Module: ${fileInfo.module} | Language: ${fileInfo.language} | LOC: ${fileInfo.loc} | Complexity: ${fileInfo.complexity_score}`);
          console.log(`  Test: ${fileInfo.is_test ? 'yes' : 'no'} | Config: ${fileInfo.is_config ? 'yes' : 'no'}\n`);

          if (syms.length > 0) {
            console.log('  Symbols:');
            formatTable(syms, [
              { key: 'name', label: 'Name', maxWidth: 30 },
              { key: 'kind', label: 'Kind' },
              { key: 'exported', label: 'Exported' },
              { key: 'line_start', label: 'Line' },
              { key: 'signature', label: 'Signature', maxWidth: 40 },
            ]);
          }

          if (imports.length > 0) {
            console.log('\n  Imports:');
            formatTable(imports, [
              { key: 'target_file', label: 'Target', maxWidth: 50 },
              { key: 'import_name', label: 'Import' },
              { key: 'import_type', label: 'Type' },
            ]);
          }

          if (importers.length > 0) {
            console.log('\n  Imported By:');
            formatTable(importers, [
              { key: 'source_file', label: 'Source', maxWidth: 50 },
              { key: 'import_name', label: 'Import' },
            ]);
          }
          console.log('');
        }
        break;
      }

      case 'symbols': {
        const pattern = args[1] || '%';
        result = q.symbols(pattern, {
          kind: getArg('--kind'),
          exported: args.includes('--exported') ? true : undefined,
          limit: parseInt(getArg('--limit', '50')),
        });
        if (!jsonMode) {
          formatTable(result, [
            { key: 'name', label: 'Name', maxWidth: 30 },
            { key: 'kind', label: 'Kind' },
            { key: 'module', label: 'Module', maxWidth: 20 },
            { key: 'file', label: 'File', maxWidth: 40 },
            { key: 'line_start', label: 'Line' },
            { key: 'exported', label: 'Exported' },
          ]);
        }
        break;
      }

      case 'modules': {
        result = q.modules();
        if (!jsonMode) {
          formatTable(result, [
            { key: 'name', label: 'Module', maxWidth: 25 },
            { key: 'root_path', label: 'Path', maxWidth: 30 },
            { key: 'file_count', label: 'Files' },
            { key: 'public_api_count', label: 'Public' },
            { key: 'internal_file_count', label: 'Internal' },
            { key: 'stability', label: 'Stability' },
            { key: 'capabilities', label: 'Capabilities', maxWidth: 40 },
          ]);
        }
        break;
      }

      case 'module': {
        const modName = args[1];
        if (!modName) { console.error('  Error: module name required'); process.exit(1); }
        result = q.moduleDetail(modName);
        if (!result) { console.error(`  Error: module not found: ${modName}`); process.exit(1); }

        if (!jsonMode) {
          console.log(`\n  Module: ${result.name}`);
          console.log(`  Root: ${result.root_path} | Files: ${result.file_count} | Stability: ${result.stability}`);
          console.log(`  Public API: ${result.public_api_count} | Internal: ${result.internal_file_count}\n`);

          if (result.capabilities.length > 0) {
            console.log('  Capabilities:');
            formatTable(result.capabilities, [
              { key: 'capability', label: 'Capability' },
              { key: 'confidence', label: 'Confidence' },
              { key: 'evidence', label: 'Evidence', maxWidth: 50 },
            ]);
          }

          if (result.dependsOn.length > 0) {
            console.log('\n  Depends On:');
            formatTable(result.dependsOn, [
              { key: 'target_module', label: 'Module', maxWidth: 25 },
              { key: 'edge_count', label: 'Edges' },
            ]);
          }

          if (result.dependedOnBy.length > 0) {
            console.log('\n  Depended On By:');
            formatTable(result.dependedOnBy, [
              { key: 'source_module', label: 'Module', maxWidth: 25 },
              { key: 'edge_count', label: 'Edges' },
            ]);
          }

          if (result.files.length > 0) {
            console.log('\n  Files:');
            formatTable(result.files.slice(0, 20), [
              { key: 'path', label: 'Path', maxWidth: 50 },
              { key: 'language', label: 'Lang' },
              { key: 'loc', label: 'LOC' },
              { key: 'complexity_score', label: 'Complexity' },
            ]);
            if (result.files.length > 20) console.log(`    ... and ${result.files.length - 20} more`);
          }
          console.log('');
        }
        break;
      }

      case 'hotspots': {
        const limit = parseInt(getArg('--limit', '20'));
        result = q.hotspots(limit);
        if (!jsonMode) {
          console.log('\n  Risk Hotspots (complexity x churn):\n');
          formatTable(result, [
            { key: 'path', label: 'File', maxWidth: 50 },
            { key: 'module', label: 'Module', maxWidth: 15 },
            { key: 'loc', label: 'LOC' },
            { key: 'complexity_score', label: 'Complexity' },
            { key: 'changes_30d', label: 'Churn(30d)' },
            { key: 'risk_score', label: 'Risk' },
          ]);
          console.log('');
        }
        break;
      }

      case 'churn': {
        const limit = parseInt(getArg('--limit', '20'));
        result = q.highChurn(limit);
        if (!jsonMode) {
          console.log('\n  Highest Churn Files:\n');
          formatTable(result, [
            { key: 'file', label: 'File', maxWidth: 50 },
            { key: 'module', label: 'Module', maxWidth: 15 },
            { key: 'changes_7d', label: '7d' },
            { key: 'changes_30d', label: '30d' },
            { key: 'changes_90d', label: '90d' },
            { key: 'last_changed', label: 'Last Changed' },
          ]);
          console.log('');
        }
        break;
      }

      case 'imports': {
        const filePath = args[1];
        if (!filePath) { console.error('  Error: file path required'); process.exit(1); }
        result = q.importsOf(filePath);
        if (!jsonMode) {
          formatTable(result, [
            { key: 'target_file', label: 'Target', maxWidth: 50 },
            { key: 'import_name', label: 'Import', maxWidth: 30 },
            { key: 'import_type', label: 'Type' },
          ]);
        }
        break;
      }

      case 'imported-by': {
        const filePath = args[1];
        if (!filePath) { console.error('  Error: file path required'); process.exit(1); }
        result = q.importedBy(filePath);
        if (!jsonMode) {
          formatTable(result, [
            { key: 'source_file', label: 'Source', maxWidth: 50 },
            { key: 'import_name', label: 'Import', maxWidth: 30 },
            { key: 'import_type', label: 'Type' },
          ]);
        }
        break;
      }

      case 'dep-chain': {
        const filePath = args[1];
        if (!filePath) { console.error('  Error: file path required'); process.exit(1); }
        const depth = parseInt(getArg('--depth', '3'));
        result = q.dependencyChain(filePath, depth);
        if (!jsonMode) {
          console.log(`\n  Dependency Chain from: ${filePath} (depth=${depth})\n`);
          for (const edge of result) {
            const indent = '  '.repeat(edge.depth);
            console.log(`  ${indent}${edge.from} -> ${edge.to}`);
          }
          console.log(`\n  Total: ${result.length} edges\n`);
        }
        break;
      }

      case 'circles': {
        result = q.circularDependencies();
        if (!jsonMode) {
          if (result.length === 0) {
            console.log('\n  No circular dependencies found.\n');
          } else {
            console.log(`\n  Found ${result.length} circular dependency chain(s):\n`);
            for (let i = 0; i < Math.min(result.length, 20); i++) {
              console.log(`  ${i + 1}. ${result[i].join(' -> ')}`);
            }
            if (result.length > 20) console.log(`  ... and ${result.length - 20} more`);
            console.log('');
          }
        }
        break;
      }

      case 'capabilities': {
        result = q.capabilities();
        if (!jsonMode) {
          formatTable(result, [
            { key: 'capability', label: 'Capability', maxWidth: 25 },
            { key: 'module_name', label: 'Module', maxWidth: 25 },
            { key: 'confidence', label: 'Confidence' },
            { key: 'evidence', label: 'Evidence', maxWidth: 50 },
          ]);
        }
        break;
      }

      case 'capability': {
        const capName = args[1];
        if (!capName) { console.error('  Error: capability name required'); process.exit(1); }
        result = q.capabilityProviders(capName);
        if (!jsonMode) {
          console.log(`\n  Modules providing "${capName}":\n`);
          formatTable(result, [
            { key: 'module_name', label: 'Module', maxWidth: 25 },
            { key: 'confidence', label: 'Confidence' },
            { key: 'evidence', label: 'Evidence', maxWidth: 50 },
          ]);
          console.log('');
        }
        break;
      }

      case 'interfaces': {
        const limit = parseInt(getArg('--limit', '20'));
        result = q.mostUsedInterfaces(limit);
        if (!jsonMode) {
          console.log('\n  Most-Used Interfaces:\n');
          formatTable(result, [
            { key: 'name', label: 'Name', maxWidth: 30 },
            { key: 'kind', label: 'Kind' },
            { key: 'module', label: 'Module', maxWidth: 20 },
            { key: 'file', label: 'File', maxWidth: 35 },
            { key: 'consumer_count', label: 'Consumers' },
          ]);
          console.log('');
        }
        break;
      }

      case 'warnings': {
        result = q.warnings({
          severity: getArg('--severity'),
          module: getArg('--module'),
          limit: parseInt(getArg('--limit', '50')),
        });
        if (!jsonMode) {
          formatTable(result, [
            { key: 'severity', label: 'Severity' },
            { key: 'module', label: 'Module', maxWidth: 20 },
            { key: 'file', label: 'File', maxWidth: 30 },
            { key: 'warning_text', label: 'Warning', maxWidth: 50 },
            { key: 'created_at', label: 'Created' },
          ]);
        }
        break;
      }

      case 'meta': {
        result = q.meta();
        if (!jsonMode) {
          console.log('\n  Graph Metadata:\n');
          for (const [key, value] of Object.entries(result)) {
            console.log(`    ${key.padEnd(20)} ${value}`);
          }
          console.log('');
        }
        break;
      }

      default:
        console.error(`  Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }

    if (jsonMode && result !== undefined) {
      console.log(JSON.stringify(result, null, 2));
    }

  } finally {
    q.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = { GraphQuery };
