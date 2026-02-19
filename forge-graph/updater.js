#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const { GraphBuilder, discoverFiles, resolveImport, estimateComplexity } = require('./builder');
const { detectModules, classifyFile } = require('./module-detector');
const { detectCapabilities } = require('./capability-detector');

// ============================================================
// Configuration
// ============================================================

const LANGUAGE_EXTENSIONS = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.java': 'java', '.go': 'go',
};

const TEST_PATTERNS = [
  /\.test\./i, /\.spec\./i, /\.e2e\./i, /__tests__\//i,
  /test\//i, /tests\//i, /testing\//i, /_test\.go$/i,
  /test_.*\.py$/i, /.*_test\.py$/i,
];

const CONFIG_PATTERNS = [
  /\.config\./i, /tsconfig/i, /eslint/i, /prettier/i,
  /webpack/i, /vite\.config/i, /jest\.config/i, /next\.config/i,
  /docker/i, /\.env/i, /Dockerfile/i, /Makefile/i,
  /package\.json$/i, /\.ya?ml$/i, /\.toml$/i,
];

// ============================================================
// Incremental Updater
// ============================================================

class GraphUpdater {
  constructor(repoRoot, dbPath) {
    this.repoRoot = path.resolve(repoRoot);
    this.dbPath = dbPath || path.join(this.repoRoot, '.forge', 'graph.db');
    this.db = null;
    this.stats = { added: 0, modified: 0, deleted: 0, unchanged: 0 };
  }

  /**
   * Run an incremental update. If the database doesn't exist, falls back to a full build.
   * @param {string} [since] - Git ref or commit to diff against (default: last build commit).
   * @returns {{ stats: object, rebuildRequired: boolean }}
   */
  update(since) {
    const startTime = Date.now();
    console.log(`\n  A-Forge Graph Engine — Incremental Update`);
    console.log(`  Repository: ${this.repoRoot}\n`);

    // Check if database exists
    if (!fs.existsSync(this.dbPath)) {
      console.log('  No existing database found. Running full build...\n');
      const builder = new GraphBuilder(this.repoRoot, this.dbPath);
      builder.build();
      return { stats: this.stats, rebuildRequired: true };
    }

    // Open existing database
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Determine what changed
    const lastBuildCommit = this.getLastBuildCommit();
    const diffBase = since || lastBuildCommit;

    if (!diffBase) {
      console.log('  No previous build reference found. Running full rebuild...\n');
      this.db.close();
      const builder = new GraphBuilder(this.repoRoot, this.dbPath);
      builder.build();
      return { stats: this.stats, rebuildRequired: true };
    }

    console.log(`  Diffing against: ${diffBase.slice(0, 12)}`);

    const changes = this.getChangedFiles(diffBase);
    const totalChanges = changes.added.length + changes.modified.length + changes.deleted.length;

    if (totalChanges === 0) {
      console.log('  No changes detected. Database is up to date.\n');
      this.updateMeta();
      this.db.close();
      return { stats: this.stats, rebuildRequired: false };
    }

    console.log(`  Changes: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length}`);

    // Check if too many changes warrant a full rebuild (>30% of files)
    const existingFileCount = this.db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
    if (totalChanges > existingFileCount * 0.3 && totalChanges > 50) {
      console.log(`  Large changeset (${totalChanges} files, ${Math.round(totalChanges / Math.max(existingFileCount, 1) * 100)}%). Running full rebuild...\n`);
      this.db.close();
      const builder = new GraphBuilder(this.repoRoot, this.dbPath);
      builder.build();
      return { stats: this.stats, rebuildRequired: true };
    }

    // Process changes incrementally
    this.processDeleted(changes.deleted);
    this.processAddedOrModified([...changes.added, ...changes.modified]);

    // Refresh module stats for affected modules
    this.refreshModuleStats(changes);

    // Update metadata
    this.updateMeta();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n  Update complete in ${elapsed}s`);
    console.log(`  Added: ${this.stats.added} | Modified: ${this.stats.modified} | Deleted: ${this.stats.deleted}`);
    console.log(`  Database: ${this.dbPath}\n`);

    this.db.close();
    return { stats: this.stats, rebuildRequired: false };
  }

  /**
   * Get the commit hash from the last successful build.
   */
  getLastBuildCommit() {
    try {
      const row = this.db.prepare("SELECT value FROM graph_meta WHERE key = 'last_commit'").get();
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current HEAD commit hash.
   */
  getCurrentCommit() {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: this.repoRoot, encoding: 'utf8', timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Get lists of added, modified, and deleted files since a given ref.
   */
  getChangedFiles(sinceRef) {
    const result = { added: [], modified: [], deleted: [] };

    try {
      const output = execSync(
        `git diff --name-status ${sinceRef}..HEAD -- .`,
        { cwd: this.repoRoot, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      for (const line of output.split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        const status = parts[0][0]; // A, M, D, R (rename)
        const filePath = parts[parts.length - 1]; // Use last part for renames

        // Only track source files
        const ext = path.extname(filePath).toLowerCase();
        if (!LANGUAGE_EXTENSIONS[ext]) continue;

        switch (status) {
          case 'A': result.added.push(filePath); break;
          case 'M': result.modified.push(filePath); break;
          case 'D': result.deleted.push(filePath); break;
          case 'R':
            // Rename: old path deleted, new path added
            const oldPath = parts[1];
            result.deleted.push(oldPath);
            result.added.push(filePath);
            break;
        }
      }
    } catch (err) {
      console.warn(`  [warn] Could not get git diff: ${err.message}`);
      // Fall back to checking file modification times
      return this.getChangedByMtime();
    }

    return result;
  }

  /**
   * Fallback: detect changes by comparing file modification times against database.
   */
  getChangedByMtime() {
    const result = { added: [], modified: [], deleted: [] };
    const currentFiles = new Set(discoverFiles(this.repoRoot));

    // Get all files from database
    const dbFiles = new Map();
    for (const row of this.db.prepare('SELECT path, last_modified FROM files').all()) {
      dbFiles.set(row.path, row.last_modified);
    }

    // Find added and modified
    for (const fp of currentFiles) {
      if (!dbFiles.has(fp)) {
        result.added.push(fp);
      } else {
        // Check mtime
        try {
          const fullPath = path.join(this.repoRoot, fp);
          const stat = fs.statSync(fullPath);
          const mtime = stat.mtime.toISOString().split('T')[0];
          if (mtime !== dbFiles.get(fp)) {
            result.modified.push(fp);
          }
        } catch {
          // File might have been deleted between discovery and stat
        }
      }
    }

    // Find deleted
    for (const fp of dbFiles.keys()) {
      if (!currentFiles.has(fp)) {
        result.deleted.push(fp);
      }
    }

    return result;
  }

  /**
   * Remove deleted files and their associated data.
   */
  processDeleted(deletedFiles) {
    if (deletedFiles.length === 0) return;

    const deleteFile = this.db.prepare('DELETE FROM files WHERE path = ?');
    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file = ?');
    const deleteDepsSource = this.db.prepare('DELETE FROM dependencies WHERE source_file = ?');
    const deleteDepsTarget = this.db.prepare('DELETE FROM dependencies WHERE target_file = ?');
    const deleteInterfaces = this.db.prepare('DELETE FROM interfaces WHERE file = ?');
    const deleteChangeFreq = this.db.prepare('DELETE FROM change_frequency WHERE file = ?');

    const deleteAll = this.db.transaction((files) => {
      for (const fp of files) {
        deleteSymbols.run(fp);
        deleteDepsSource.run(fp);
        deleteDepsTarget.run(fp);
        deleteInterfaces.run(fp);
        deleteChangeFreq.run(fp);
        deleteFile.run(fp);
      }
    });

    deleteAll(deletedFiles);
    this.stats.deleted = deletedFiles.length;
    console.log(`  Deleted ${deletedFiles.length} file(s) from graph`);
  }

  /**
   * Add or update files in the graph.
   */
  processAddedOrModified(filePaths) {
    if (filePaths.length === 0) return;

    // Get all current file paths for import resolution
    const allFilePaths = this.db.prepare('SELECT path FROM files').all().map(r => r.path);
    const allFileSet = new Set([...allFilePaths, ...filePaths]);
    const allFiles = [...allFileSet];

    // Detect modules for file assignment
    const { modules, fileModuleMap } = detectModules(this.repoRoot, allFiles);

    // Initialize tree-sitter via a temporary builder (for parser access)
    const builder = new GraphBuilder(this.repoRoot, this.dbPath);
    builder.parserMgr.init();

    // Prepare statements
    const insertFile = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, module, language, loc, complexity_score, last_modified, is_test, is_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file = ?');
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols (name, kind, file, line_start, line_end, exported, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteDeps = this.db.prepare('DELETE FROM dependencies WHERE source_file = ?');
    const insertDep = this.db.prepare(`
      INSERT OR IGNORE INTO dependencies (source_file, target_file, import_name, import_type)
      VALUES (?, ?, ?, ?)
    `);
    const deleteInterfaces = this.db.prepare('DELETE FROM interfaces WHERE file = ?');
    const insertInterface = this.db.prepare(`
      INSERT INTO interfaces (name, file, kind, consumer_count, contract_hash)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateAll = this.db.transaction((files) => {
      for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        const language = LANGUAGE_EXTENSIONS[ext];
        if (!language) continue;

        const fullPath = path.join(this.repoRoot, filePath);
        let source;
        try {
          source = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }

        const loc = source.split('\n').length;
        const complexity = estimateComplexity(source, language);
        const isTest = TEST_PATTERNS.some(p => p.test(filePath));
        const isConfig = CONFIG_PATTERNS.some(p => p.test(filePath));
        const moduleName = fileModuleMap.get(filePath) || '<root>';
        const lastModified = this.getFileLastModified(filePath);

        // Parse symbols and imports
        let symbols = [];
        let imports = [];

        const parser = builder.parserMgr.getParser(language, filePath);
        if (parser) {
          try {
            const tree = parser.parse(source);
            const { extractFromAST } = require('./builder');
            // We can't import extractFromAST directly since it's not exported
            // Use regex fallback instead for incremental updates
            const { symbols: s, imports: i } = this.extractWithRegex(source, language);
            symbols = s;
            imports = i;
          } catch {
            const { symbols: s, imports: i } = this.extractWithRegex(source, language);
            symbols = s;
            imports = i;
          }
        } else {
          const { symbols: s, imports: i } = this.extractWithRegex(source, language);
          symbols = s;
          imports = i;
        }

        // Write file record
        insertFile.run(filePath, moduleName, language, loc, complexity, lastModified, isTest ? 1 : 0, isConfig ? 1 : 0);

        // Clear and rewrite symbols
        deleteSymbols.run(filePath);
        for (const sym of symbols) {
          insertSymbol.run(sym.name, sym.kind, filePath, sym.line_start, sym.line_end, sym.exported ? 1 : 0, sym.signature);
        }

        // Clear and rewrite interfaces for exported symbols
        deleteInterfaces.run(filePath);
        for (const sym of symbols) {
          if (sym.exported) {
            const kindMap = {
              function: 'export_function', class: 'export_class',
              type: 'export_type', interface: 'export_type',
              component: 'export_component', const: 'export_function',
              enum: 'export_type',
            };
            const interfaceKind = kindMap[sym.kind] || 'export_function';
            const hash = crypto.createHash('sha256').update(sym.signature || sym.name).digest('hex').slice(0, 16);
            insertInterface.run(sym.name, filePath, interfaceKind, 0, hash);
          }
        }

        // Clear and rewrite dependencies from this file
        deleteDeps.run(filePath);
        for (const imp of imports) {
          const resolved = resolveImport(imp.name, filePath, allFiles);
          if (resolved && resolved !== filePath) {
            insertDep.run(filePath, resolved, imp.name, imp.type);
          }
        }
      }
    });

    updateAll(filePaths);

    // Count added vs modified
    const existingPaths = new Set(allFilePaths);
    for (const fp of filePaths) {
      if (existingPaths.has(fp)) this.stats.modified++;
      else this.stats.added++;
    }

    console.log(`  Processed ${filePaths.length} file(s) (${this.stats.added} new, ${this.stats.modified} updated)`);
  }

  /**
   * Regex-based extraction (same as builder.js fallback).
   */
  extractWithRegex(source, language) {
    const symbols = [];
    const imports = [];
    const lines = source.split('\n');

    if (language === 'javascript' || language === 'typescript') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const exportFunc = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
        if (exportFunc) symbols.push({ name: exportFunc[1], kind: 'function', line_start: i + 1, line_end: i + 1, exported: true, signature: null });
        const exportClass = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
        if (exportClass) symbols.push({ name: exportClass[1], kind: 'class', line_start: i + 1, line_end: i + 1, exported: true, signature: null });
        const exportConst = line.match(/^export\s+const\s+(\w+)/);
        if (exportConst) symbols.push({ name: exportConst[1], kind: 'const', line_start: i + 1, line_end: i + 1, exported: true, signature: null });
        const exportInterface = line.match(/^export\s+interface\s+(\w+)/);
        if (exportInterface) symbols.push({ name: exportInterface[1], kind: 'interface', line_start: i + 1, line_end: i + 1, exported: true, signature: null });
        const exportType = line.match(/^export\s+type\s+(\w+)/);
        if (exportType) symbols.push({ name: exportType[1], kind: 'type', line_start: i + 1, line_end: i + 1, exported: true, signature: null });
        const funcDecl = line.match(/^(?:async\s+)?function\s+(\w+)/);
        if (funcDecl && !line.startsWith('export')) symbols.push({ name: funcDecl[1], kind: 'function', line_start: i + 1, line_end: i + 1, exported: false, signature: null });
        const importMatch = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          const importType = line.includes('* as') ? 'namespace' : line.includes('{') ? 'named' : 'default';
          imports.push({ name: importMatch[1], type: importType });
        }
        const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (requireMatch) imports.push({ name: requireMatch[1], type: 'require' });
      }
    } else if (language === 'python') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
        if (funcMatch) symbols.push({ name: funcMatch[1], kind: 'function', line_start: i + 1, line_end: i + 1, exported: !funcMatch[1].startsWith('_'), signature: null });
        const classMatch = line.match(/^class\s+(\w+)/);
        if (classMatch) symbols.push({ name: classMatch[1], kind: 'class', line_start: i + 1, line_end: i + 1, exported: !classMatch[1].startsWith('_'), signature: null });
        const importMatch = line.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/);
        if (importMatch) imports.push({ name: importMatch[1] || importMatch[2], type: line.startsWith('from') ? 'named' : 'namespace' });
      }
    }

    return { symbols, imports };
  }

  /**
   * Get last modified date for a single file from git.
   */
  getFileLastModified(filePath) {
    try {
      const output = execSync(
        `git log -1 --format=%aI -- "${filePath}"`,
        { cwd: this.repoRoot, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return output.trim().split('T')[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh module stats and capabilities for affected modules.
   */
  refreshModuleStats(changes) {
    // Find affected modules
    const affectedModules = new Set();
    const allAffected = [...changes.added, ...changes.modified, ...changes.deleted];

    for (const fp of allAffected) {
      const row = this.db.prepare('SELECT module FROM files WHERE path = ?').get(fp);
      if (row) affectedModules.add(row.module);
    }

    if (affectedModules.size === 0) return;

    console.log(`  Refreshing ${affectedModules.size} module(s)...`);

    const updateModule = this.db.prepare(`
      INSERT OR REPLACE INTO modules (name, root_path, file_count, public_api_count, internal_file_count, stability)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const deleteModCaps = this.db.prepare('DELETE FROM module_capabilities WHERE module_name = ?');
    const insertCap = this.db.prepare(`
      INSERT OR REPLACE INTO module_capabilities (module_name, capability, confidence, evidence)
      VALUES (?, ?, ?, ?)
    `);
    const deleteModDeps = this.db.prepare('DELETE FROM module_dependencies WHERE source_module = ?');
    const insertModDep = this.db.prepare(`
      INSERT OR REPLACE INTO module_dependencies (source_module, target_module, edge_count)
      VALUES (?, ?, ?)
    `);

    const refresh = this.db.transaction(() => {
      for (const modName of affectedModules) {
        // Get module info
        const modRow = this.db.prepare('SELECT root_path FROM modules WHERE name = ?').get(modName);
        if (!modRow) continue;

        const rootPath = modRow.root_path;

        // Count files
        const files = this.db.prepare('SELECT path FROM files WHERE module = ?').all(modName).map(r => r.path);
        const fileCount = files.length;

        let publicApiCount = 0;
        let internalCount = 0;
        for (const fp of files) {
          const cls = classifyFile(fp, rootPath);
          if (cls === 'public') publicApiCount++;
          else internalCount++;
        }

        // Stability from change frequency
        let totalChanges = 0;
        for (const fp of files) {
          const cfRow = this.db.prepare('SELECT changes_30d FROM change_frequency WHERE file = ?').get(fp);
          if (cfRow) totalChanges += cfRow.changes_30d;
        }
        const avgChanges = fileCount > 0 ? totalChanges / fileCount : 0;
        const stability = avgChanges <= 1 ? 'high' : avgChanges <= 5 ? 'medium' : 'low';

        updateModule.run(modName, rootPath, fileCount, publicApiCount, internalCount, stability);

        // Refresh capabilities
        deleteModCaps.run(modName);
        const modSymbols = this.db.prepare('SELECT name, file FROM symbols WHERE file IN (SELECT path FROM files WHERE module = ?) AND exported = 1').all(modName);
        const modImports = this.db.prepare('SELECT source_file, import_name FROM dependencies WHERE source_file IN (SELECT path FROM files WHERE module = ?)').all(modName);
        const caps = detectCapabilities(modName, files, modSymbols, modImports);
        for (const cap of caps) {
          insertCap.run(modName, cap.capability, cap.confidence, cap.evidence);
        }

        // Refresh module-level dependencies
        deleteModDeps.run(modName);
        const deps = this.db.prepare(`
          SELECT d.target_file, f.module as target_module, COUNT(*) as cnt
          FROM dependencies d
          JOIN files f ON d.target_file = f.path
          WHERE d.source_file IN (SELECT path FROM files WHERE module = ?)
          AND f.module != ?
          GROUP BY f.module
        `).all(modName, modName);

        for (const dep of deps) {
          if (dep.target_module) {
            insertModDep.run(modName, dep.target_module, dep.cnt);
          }
        }
      }
    });

    refresh();
  }

  /**
   * Update build metadata.
   */
  updateMeta() {
    const currentCommit = this.getCurrentCommit();
    const insertMeta = this.db.prepare('INSERT OR REPLACE INTO graph_meta (key, value) VALUES (?, ?)');

    const updateMetaTx = this.db.transaction(() => {
      insertMeta.run('updated_at', new Date().toISOString());
      if (currentCommit) {
        insertMeta.run('last_commit', currentCommit);
      }
      // Update counts
      const fileCount = this.db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
      const symbolCount = this.db.prepare('SELECT COUNT(*) as cnt FROM symbols').get().cnt;
      const depCount = this.db.prepare('SELECT COUNT(*) as cnt FROM dependencies').get().cnt;
      const modCount = this.db.prepare('SELECT COUNT(*) as cnt FROM modules').get().cnt;
      insertMeta.run('file_count', String(fileCount));
      insertMeta.run('symbol_count', String(symbolCount));
      insertMeta.run('dependency_count', String(depCount));
      insertMeta.run('module_count', String(modCount));
    });

    updateMetaTx();
  }
}

// ============================================================
// CLI Entry Point
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoRoot = args[0] || process.cwd();
  const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1] : undefined;
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : undefined;

  const updater = new GraphUpdater(repoRoot, dbPath);
  updater.update(since);
}

module.exports = { GraphUpdater };
