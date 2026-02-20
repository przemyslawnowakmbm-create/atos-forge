#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// Configuration (unified config with hardcoded fallbacks)
// ============================================================

function loadDashboardConfig(cwd) {
  try {
    const config = require('../forge-config/config');
    const { config: effective } = config.loadConfig(cwd);
    return effective.graph || {};
  } catch {
    return {};
  }
}

/**
 * Check if dashboard auto-regeneration is enabled.
 * @param {string} cwd - Project root
 * @returns {boolean}
 */
function shouldAutoRegenerate(cwd) {
  const cfg = loadDashboardConfig(cwd);
  return cfg.dashboard_auto_regenerate !== false;
}

// ============================================================
// Data Collection
// ============================================================

/**
 * Collect all data needed for the dashboard from the graph database.
 * @param {string} dbPath
 * @returns {object} Dashboard data payload
 */
function collectDashboardData(dbPath) {
  const { GraphQuery } = require('./query');
  const q = new GraphQuery(dbPath);
  try {
    q.open();

    const meta = q.meta();
    const summary = q.summary();
    const depGraph = q.moduleDependencyGraph();

    // Module details for side panels
    const moduleDetails = {};
    for (const mod of depGraph.nodes) {
      const detail = q.moduleDetail(mod.name);
      if (detail) {
        moduleDetails[mod.name] = {
          name: detail.name,
          root_path: detail.root_path,
          file_count: detail.file_count,
          public_api_count: detail.public_api_count,
          stability: detail.stability,
          files: (detail.files || []).slice(0, 500).map(f => ({
            path: f.path, language: f.language, loc: f.loc, complexity_score: f.complexity_score,
          })),
          capabilities: (detail.capabilities || []).slice(0, 50),
          dependsOn: detail.dependsOn || [],
          dependedOnBy: detail.dependedOnBy || [],
          publicAPI: (detail.publicAPI || []).slice(0, 200).map(s => ({
            name: s.name, kind: s.kind, file: s.file,
            signature: s.signature, consumer_count: s.consumer_count || 0,
          })),
        };
      }
    }

    // File list for dependency explorer
    const allFiles = q.files({ limit: 2000 }).map(f => ({
      p: f.path, m: f.module, l: f.language, o: f.loc, c: f.complexity_score,
    }));

    // Hotspots
    const hotspots = q.hotspots(200);

    // Capabilities matrix
    const capabilities = q.capabilities();

    // Cycles
    const cycles = q.getCycles();

    // Interfaces
    const interfaces = q.mostUsedInterfaces(100);

    // High churn
    const highChurn = q.highChurn(100);

    // File-level deps (compressed keys for size)
    const fileDeps = q.db.prepare('SELECT source_file, target_file, import_name, import_type FROM dependencies').all()
      .map(d => ({ s: d.source_file, t: d.target_file, n: d.import_name, y: d.import_type }));

    // Unstable modules
    const unstableModules = depGraph.nodes
      .filter(n => n.stability === 'low')
      .map(n => ({ name: n.name, file_count: n.file_count }));

    // Project name from meta or directory
    const projectRoot = path.dirname(path.dirname(dbPath));
    const projectName = meta.project_name || path.basename(projectRoot);

    return {
      projectName,
      meta,
      languages: summary.languages,
      moduleGraph: depGraph,
      moduleDetails,
      files: allFiles,
      hotspots,
      capabilities,
      cycles,
      interfaces,
      highChurn,
      unstableModules,
      fileDeps,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    q.close();
  }
}

// ============================================================
// CSS Generation
// ============================================================

function generateCSS() {
  return `
    :root {
      --bg: #0f0f1a;
      --bg-card: #1a1a2e;
      --bg-hover: #242442;
      --bg-input: #12122a;
      --border: #2a2a4a;
      --text: #e0e0e0;
      --text-dim: #888;
      --accent: #00d4ff;
      --accent-dim: #0088aa;
      --green: #00c853;
      --yellow: #ffd600;
      --red: #ff1744;
      --orange: #ff6e40;
      --panel-width: 420px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      z-index: 10;
    }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .header-left h1 {
      font-size: 16px; font-weight: 700; color: var(--accent);
      letter-spacing: 1px; text-transform: uppercase;
    }
    .header-left .project-name { font-size: 14px; color: var(--text-dim); }
    .header-stats { display: flex; gap: 24px; }
    .header-stats .stat { font-size: 12px; color: var(--text-dim); }
    .header-stats .stat strong { color: var(--accent); font-size: 14px; margin-right: 4px; }
    .header-right { font-size: 11px; color: var(--text-dim); text-align: right; line-height: 1.5; }

    /* Tab navigation */
    .tab-nav {
      display: flex;
      background: var(--bg-card);
      border-bottom: 2px solid var(--border);
      flex-shrink: 0;
      z-index: 10;
    }
    .tab-btn {
      padding: 10px 24px;
      background: none;
      border: none;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 13px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: color 0.2s, border-color 0.2s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

    /* Tab content */
    .tab-content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    .tab-content.hidden { display: none; }

    /* Search bar (module map) */
    .search-bar {
      position: absolute;
      top: 12px; left: 12px;
      z-index: 5;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .search-bar input {
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      width: 260px;
      outline: none;
    }
    .search-bar input:focus { border-color: var(--accent); }
    .search-bar .legend {
      display: flex; gap: 12px; font-size: 11px; color: var(--text-dim);
    }
    .search-bar .legend-dot {
      display: inline-block; width: 10px; height: 10px;
      border-radius: 50%; margin-right: 4px; vertical-align: middle;
    }

    /* SVG */
    .tab-content svg { width: 100%; height: 100%; display: block; }

    /* Side Panel */
    .side-panel {
      position: fixed;
      top: 0; right: 0;
      width: var(--panel-width);
      height: 100vh;
      background: var(--bg-card);
      border-left: 1px solid var(--border);
      z-index: 100;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      display: flex;
      flex-direction: column;
      box-shadow: -4px 0 20px rgba(0,0,0,0.5);
    }
    .side-panel.open { transform: translateX(0); }
    .side-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .side-panel-header h2 { font-size: 14px; color: var(--accent); }
    .side-panel-close {
      background: none; border: none; color: var(--text-dim);
      font-size: 20px; cursor: pointer; line-height: 1;
    }
    .side-panel-close:hover { color: var(--text); }
    .side-panel-body {
      flex: 1; overflow-y: auto; padding: 16px 20px;
    }
    .panel-section { margin-bottom: 16px; }
    .panel-section h3 {
      font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-dim); margin-bottom: 8px; border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
    }
    .panel-kv { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
    .panel-kv .k { color: var(--text-dim); }
    .panel-kv .v { color: var(--text); font-weight: 600; }
    .panel-list { list-style: none; font-size: 12px; }
    .panel-list li { padding: 3px 0; color: var(--text-dim); }
    .panel-list li .name { color: var(--text); }
    .panel-list li .badge {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      font-size: 10px; margin-left: 6px;
    }
    .badge-high { background: rgba(0,200,83,0.2); color: var(--green); }
    .badge-medium { background: rgba(255,214,0,0.2); color: var(--yellow); }
    .badge-low { background: rgba(255,23,68,0.2); color: var(--red); }

    /* Tooltip */
    .tooltip {
      position: absolute;
      pointer-events: none;
      background: #111128;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 11px;
      color: var(--text);
      z-index: 200;
      max-width: 350px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      white-space: nowrap;
    }
    .tooltip .tt-label { color: var(--text-dim); }
    .tooltip .tt-value { color: var(--accent); font-weight: 600; }

    /* Dependency explorer */
    .dep-controls {
      position: absolute; top: 12px; left: 12px; z-index: 5;
      display: flex; gap: 12px; align-items: center;
    }
    .dep-controls select {
      background: var(--bg-input); border: 1px solid var(--border);
      color: var(--text); padding: 6px 10px; border-radius: 4px;
      font-family: inherit; font-size: 12px; width: 340px; outline: none;
    }
    .dep-controls select:focus { border-color: var(--accent); }
    .dep-label { font-size: 11px; color: var(--text-dim); }
    .dep-tree-container {
      display: flex; width: 100%; height: 100%; padding-top: 50px;
    }
    .dep-tree-half {
      flex: 1; overflow: hidden; position: relative;
      border-right: 1px solid var(--border);
    }
    .dep-tree-half:last-child { border-right: none; }
    .dep-tree-title {
      position: absolute; top: 4px; left: 12px;
      font-size: 11px; color: var(--text-dim); text-transform: uppercase;
      letter-spacing: 1px;
    }

    /* Treemap */
    .treemap-container { width: 100%; height: 100%; position: relative; }
    .treemap-cell {
      position: absolute; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer; transition: opacity 0.15s;
    }
    .treemap-cell:hover { opacity: 0.85; }
    .treemap-cell .cell-label {
      padding: 3px 5px; font-size: 10px; color: rgba(255,255,255,0.8);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .treemap-group-label {
      position: absolute; font-size: 11px; color: var(--accent);
      font-weight: 700; letter-spacing: 0.5px; padding: 2px 6px;
      background: rgba(0,0,0,0.6); z-index: 2;
    }

    /* Capability matrix */
    .cap-matrix-container { width: 100%; height: 100%; overflow: auto; padding: 16px; }
    .cap-matrix {
      border-collapse: collapse; font-size: 12px; width: auto;
    }
    .cap-matrix th {
      padding: 6px 10px; text-align: left; font-weight: 600;
      border-bottom: 1px solid var(--border); color: var(--text-dim);
      position: sticky; top: 0; background: var(--bg-card); z-index: 2;
    }
    .cap-matrix th.rotated {
      writing-mode: vertical-rl; text-orientation: mixed;
      transform: rotate(180deg); white-space: nowrap;
      height: 120px; padding: 8px 4px;
    }
    .cap-matrix td {
      padding: 0; width: 36px; height: 32px;
      text-align: center; cursor: pointer;
      border: 1px solid rgba(255,255,255,0.04);
      transition: opacity 0.15s;
    }
    .cap-matrix td:hover { opacity: 0.75; }
    .cap-matrix td.mod-name {
      padding: 6px 12px; width: auto; cursor: default;
      text-align: left; font-weight: 600; color: var(--text);
      white-space: nowrap;
    }
    .cap-conf { font-size: 10px; font-weight: 600; }

    /* Risk register */
    .risk-container { width: 100%; height: 100%; overflow: auto; padding: 16px; }
    .risk-table {
      border-collapse: collapse; font-size: 12px; width: 100%;
    }
    .risk-table th {
      padding: 8px 12px; text-align: left; font-weight: 600;
      border-bottom: 2px solid var(--border); color: var(--text-dim);
      cursor: pointer; user-select: none; position: sticky; top: 0;
      background: var(--bg-card); z-index: 2;
    }
    .risk-table th:hover { color: var(--accent); }
    .risk-table th .sort-arrow { margin-left: 4px; font-size: 10px; }
    .risk-table td {
      padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .risk-table tr { transition: background 0.15s; cursor: pointer; }
    .risk-table tr:hover { background: var(--bg-hover); }
    .risk-table tr.risk-low { background: rgba(0,200,83,0.04); }
    .risk-table tr.risk-medium { background: rgba(255,214,0,0.06); }
    .risk-table tr.risk-high { background: rgba(255,23,68,0.08); }
    .risk-table tr.risk-critical { background: rgba(255,23,68,0.15); }
    .risk-badge {
      display: inline-block; padding: 2px 8px; border-radius: 3px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
    }
    .risk-badge.LOW { background: rgba(0,200,83,0.2); color: var(--green); }
    .risk-badge.MEDIUM { background: rgba(255,214,0,0.2); color: var(--yellow); }
    .risk-badge.HIGH { background: rgba(255,23,68,0.2); color: var(--red); }
    .risk-badge.CRITICAL { background: rgba(255,23,68,0.4); color: #fff; }

    /* Evidence popup */
    .evidence-popup {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 8px; padding: 20px; z-index: 300;
      max-width: 500px; max-height: 400px; overflow-y: auto;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    }
    .evidence-popup h3 { font-size: 13px; color: var(--accent); margin-bottom: 10px; }
    .evidence-popup .evidence-text { font-size: 12px; color: var(--text-dim); line-height: 1.6; }
    .evidence-popup .close-btn {
      position: absolute; top: 8px; right: 12px;
      background: none; border: none; color: var(--text-dim);
      font-size: 18px; cursor: pointer;
    }
    .overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 250;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

    /* Empty state */
    .empty-state {
      display: flex; align-items: center; justify-content: center;
      height: 100%; color: var(--text-dim); font-size: 14px;
    }
  `;
}

// ============================================================
// HTML Shell
// ============================================================

function generateHTML(data) {
  return `
  <header class="dashboard-header">
    <div class="header-left">
      <h1>A-Forge Code Graph</h1>
      <span class="project-name">${esc(data.projectName)}</span>
    </div>
    <div class="header-stats">
      <span class="stat"><strong>${esc(data.meta.total_files || data.meta.file_count || '0')}</strong>files</span>
      <span class="stat"><strong>${esc(data.meta.total_symbols || data.meta.symbol_count || '0')}</strong>symbols</span>
      <span class="stat"><strong>${esc(String(data.moduleGraph.nodes.length))}</strong>modules</span>
      <span class="stat"><strong>${esc(data.meta.dependency_count || '0')}</strong>deps</span>
    </div>
    <div class="header-right">
      <div>Built: ${esc(data.meta.last_build_time || data.meta.built_at || 'unknown')}</div>
      <div>Generated: ${esc(data.generatedAt.slice(0, 19).replace('T', ' '))}</div>
    </div>
  </header>
  <nav class="tab-nav">
    <button class="tab-btn active" data-tab="tab-module-map">Module Map</button>
    <button class="tab-btn" data-tab="tab-dep-explorer">Dependency Explorer</button>
    <button class="tab-btn" data-tab="tab-hotspot-heatmap">Hotspot Heatmap</button>
    <button class="tab-btn" data-tab="tab-capability-matrix">Capability Matrix</button>
    <button class="tab-btn" data-tab="tab-risk-register">Risk Register</button>
  </nav>

  <!-- Tab 1: Module Map -->
  <div id="tab-module-map" class="tab-content">
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="Search modules, files, symbols..." />
      <div class="legend">
        <span><span class="legend-dot" style="background:#00c853"></span>Stable</span>
        <span><span class="legend-dot" style="background:#ffd600"></span>Medium</span>
        <span><span class="legend-dot" style="background:#ff1744"></span>Unstable</span>
      </div>
    </div>
  </div>

  <!-- Tab 2: Dependency Explorer -->
  <div id="tab-dep-explorer" class="tab-content hidden">
    <div class="dep-controls">
      <select id="dep-file-select"><option value="">Select a file...</option></select>
    </div>
    <div class="dep-tree-container">
      <div class="dep-tree-half" id="dep-upstream">
        <span class="dep-tree-title">Imports (upstream)</span>
        <svg id="dep-upstream-svg"></svg>
      </div>
      <div class="dep-tree-half" id="dep-downstream">
        <span class="dep-tree-title">Consumers (downstream)</span>
        <svg id="dep-downstream-svg"></svg>
      </div>
    </div>
  </div>

  <!-- Tab 3: Hotspot Heatmap -->
  <div id="tab-hotspot-heatmap" class="tab-content hidden">
    <div class="treemap-container" id="treemap-container"></div>
  </div>

  <!-- Tab 4: Capability Matrix -->
  <div id="tab-capability-matrix" class="tab-content hidden">
    <div class="cap-matrix-container" id="cap-matrix-container"></div>
  </div>

  <!-- Tab 5: Risk Register -->
  <div id="tab-risk-register" class="tab-content hidden">
    <div class="risk-container" id="risk-container"></div>
  </div>

  <!-- Side Panel -->
  <div class="side-panel" id="side-panel">
    <div class="side-panel-header">
      <h2 id="panel-title">Details</h2>
      <button class="side-panel-close" id="panel-close">&times;</button>
    </div>
    <div class="side-panel-body" id="panel-body"></div>
  </div>

  <!-- Tooltip -->
  <div class="tooltip" id="tooltip" style="display:none"></div>
  `;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// JavaScript Generation (all 5 tabs + interactions)
// ============================================================

function generateJS() {
  return `
(function() {
  'use strict';
  const D = window.__GRAPH_DATA__;
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ============================================================
  // Utilities
  // ============================================================

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function basename(p) { return p ? p.split('/').pop() : ''; }

  function fileModule(fp) {
    const f = D.files.find(x => x.p === fp);
    return f ? f.m : null;
  }

  const stabilityColor = { high: '#00c853', medium: '#ffd600', low: '#ff1744' };

  // Tooltip
  const tooltipEl = $('#tooltip');
  function showTooltip(evt, html) {
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = (evt.pageX + 12) + 'px';
    tooltipEl.style.top = (evt.pageY - 10) + 'px';
  }
  function hideTooltip() { tooltipEl.style.display = 'none'; }

  // Side Panel
  function openPanel(title, bodyHTML) {
    $('#panel-title').textContent = title;
    $('#panel-body').innerHTML = bodyHTML;
    $('#side-panel').classList.add('open');
  }
  function closePanel() { $('#side-panel').classList.remove('open'); }
  $('#panel-close').addEventListener('click', closePanel);

  // Tab switching
  let activeTab = 'tab-module-map';
  const tabInited = {};
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-content').forEach(t => t.classList.add('hidden'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.remove('hidden');
      activeTab = tabId;
      if (!tabInited[tabId]) {
        tabInited[tabId] = true;
        if (tabId === 'tab-dep-explorer') initDepExplorer();
        if (tabId === 'tab-hotspot-heatmap') initHotspotHeatmap();
        if (tabId === 'tab-capability-matrix') initCapabilityMatrix();
        if (tabId === 'tab-risk-register') initRiskRegister();
      }
      // Resize handler for treemap
      if (tabId === 'tab-hotspot-heatmap' && tabInited[tabId]) {
        setTimeout(() => initHotspotHeatmap(), 50);
      }
    });
  });

  // ============================================================
  // TAB 1: Module Map (D3 Force-Directed)
  // ============================================================

  (function initModuleMap() {
    tabInited['tab-module-map'] = true;
    const container = document.getElementById('tab-module-map');
    const rect = container.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height || 600;

    const svg = d3.select('#tab-module-map').append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g');

    // Zoom
    svg.call(d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => g.attr('transform', e.transform)));

    // Prep data — deep clone to avoid mutation
    const nodes = D.moduleGraph.nodes.map(n => ({...n}));
    const edges = D.moduleGraph.edges.map(e => ({
      source: e.source_module, target: e.target_module, edge_count: e.edge_count || 1
    }));

    // Ensure all edge endpoints exist as nodes
    const nodeSet = new Set(nodes.map(n => n.name));
    for (const e of edges) {
      if (!nodeSet.has(e.source)) { nodes.push({ name: e.source, file_count: 1, stability: 'medium' }); nodeSet.add(e.source); }
      if (!nodeSet.has(e.target)) { nodes.push({ name: e.target, file_count: 1, stability: 'medium' }); nodeSet.add(e.target); }
    }

    if (nodes.length === 0) {
      container.innerHTML += '<div class="empty-state">No modules found. Build the graph first.</div>';
      return;
    }

    const maxFiles = d3.max(nodes, n => n.file_count) || 1;
    const sizeScale = d3.scaleSqrt().domain([0, maxFiles]).range([18, 60]);
    const maxEdge = d3.max(edges, e => e.edge_count) || 1;
    const edgeWidthScale = d3.scaleLinear().domain([1, maxEdge]).range([1, 8]);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.name).distance(180).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius(d => sizeScale(d.file_count) + 15))
      .alphaDecay(0.025);

    // Links
    const link = g.append('g').attr('class', 'links').selectAll('line')
      .data(edges).join('line')
      .attr('stroke', '#444')
      .attr('stroke-width', d => edgeWidthScale(d.edge_count))
      .attr('stroke-opacity', 0.5);

    // Arrow markers
    svg.append('defs').selectAll('marker').data(['arrow']).join('marker')
      .attr('id', 'arrow').attr('viewBox', '0 0 10 10')
      .attr('refX', 25).attr('refY', 5)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,0L10,5L0,10Z').attr('fill', '#555');
    link.attr('marker-end', 'url(#arrow)');

    // Edge tooltips
    link.on('mouseover', function(evt, d) {
      d3.select(this).attr('stroke', '#00d4ff').attr('stroke-opacity', 1);
      const srcName = typeof d.source === 'object' ? d.source.name : d.source;
      const tgtName = typeof d.target === 'object' ? d.target.name : d.target;
      showTooltip(evt, '<span class="tt-value">' + esc(srcName) + '</span>' +
        ' \\u2192 <span class="tt-value">' + esc(tgtName) + '</span>' +
        ': <span class="tt-value">' + d.edge_count + '</span> imports');
    }).on('mouseout', function() {
      d3.select(this).attr('stroke', '#444').attr('stroke-opacity', 0.5);
      hideTooltip();
    });

    // Nodes
    const node = g.append('g').attr('class', 'nodes').selectAll('g')
      .data(nodes).join('g')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append('circle')
      .attr('r', d => sizeScale(d.file_count))
      .attr('fill', d => stabilityColor[d.stability] || '#ffd600')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.85);

    node.append('text')
      .text(d => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => sizeScale(d.file_count) + 16)
      .attr('fill', '#e0e0e0')
      .attr('font-size', '12px')
      .attr('font-weight', '600');

    // Click node -> side panel
    node.style('cursor', 'pointer').on('click', (evt, d) => {
      const detail = D.moduleDetails[d.name];
      if (!detail) return;
      let html = '<div class="panel-section"><h3>Overview</h3>';
      html += kv('Files', detail.file_count);
      html += kv('Public API', detail.public_api_count);
      html += kv('Stability', '<span style="color:' + (stabilityColor[detail.stability]||'#ffd600') + '">' + esc(detail.stability) + '</span>');
      html += kv('Root', detail.root_path);
      html += '</div>';

      if (detail.capabilities && detail.capabilities.length) {
        html += '<div class="panel-section"><h3>Capabilities</h3><ul class="panel-list">';
        for (const c of detail.capabilities) {
          html += '<li><span class="name">' + esc(c.capability) + '</span>';
          html += ' <span style="color:#888">(' + (c.confidence * 100).toFixed(0) + '%)</span></li>';
        }
        html += '</ul></div>';
      }

      if (detail.dependsOn && detail.dependsOn.length) {
        html += '<div class="panel-section"><h3>Depends On</h3><ul class="panel-list">';
        for (const dep of detail.dependsOn.slice(0, 15)) {
          html += '<li><span class="name">' + esc(dep.target_module) + '</span>';
          html += ' <span style="color:#888">(' + dep.edge_count + ' imports)</span></li>';
        }
        html += '</ul></div>';
      }

      if (detail.dependedOnBy && detail.dependedOnBy.length) {
        html += '<div class="panel-section"><h3>Depended On By</h3><ul class="panel-list">';
        for (const dep of detail.dependedOnBy.slice(0, 15)) {
          html += '<li><span class="name">' + esc(dep.source_module) + '</span>';
          html += ' <span style="color:#888">(' + dep.edge_count + ' imports)</span></li>';
        }
        html += '</ul></div>';
      }

      if (detail.publicAPI && detail.publicAPI.length) {
        html += '<div class="panel-section"><h3>Public API (top ' + Math.min(detail.publicAPI.length, 20) + ')</h3><ul class="panel-list">';
        for (const s of detail.publicAPI.slice(0, 20)) {
          html += '<li><span class="name">' + esc(s.name) + '</span>';
          html += ' <span class="badge ' + (s.consumer_count > 10 ? 'badge-low' : s.consumer_count > 3 ? 'badge-medium' : 'badge-high') + '">';
          html += s.consumer_count + ' consumers</span>';
          if (s.kind) html += ' <span style="color:#888">' + esc(s.kind) + '</span>';
          html += '</li>';
        }
        html += '</ul></div>';
      }

      if (detail.files && detail.files.length) {
        html += '<div class="panel-section"><h3>Top Files by LOC</h3><ul class="panel-list">';
        for (const f of detail.files.slice(0, 15)) {
          html += '<li><span class="name">' + esc(basename(f.path)) + '</span>';
          html += ' <span style="color:#888">' + f.loc + ' LOC</span></li>';
        }
        html += '</ul></div>';
      }

      openPanel(d.name, html);
    });

    // Hover node
    node.on('mouseover', function(evt, d) {
      d3.select(this).select('circle').attr('stroke', '#00d4ff').attr('stroke-width', 3);
      showTooltip(evt, '<span class="tt-value">' + esc(d.name) + '</span><br>' +
        '<span class="tt-label">Files:</span> ' + d.file_count +
        ' | <span class="tt-label">Stability:</span> ' + (d.stability || 'unknown'));
    }).on('mouseout', function() {
      d3.select(this).select('circle').attr('stroke', '#fff').attr('stroke-width', 2);
      hideTooltip();
    });

    // Tick
    simulation.on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });

    // Search
    $('#search-input').addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      if (!q) {
        node.select('circle').attr('stroke', '#fff').attr('stroke-width', 2).attr('opacity', 0.85);
        node.select('text').attr('opacity', 1);
        link.attr('stroke-opacity', 0.5);
        return;
      }
      // Match modules by name or by files/symbols containing query
      node.each(function(d) {
        const detail = D.moduleDetails[d.name];
        let match = d.name.toLowerCase().includes(q);
        if (!match && detail) {
          match = detail.files.some(f => f.path.toLowerCase().includes(q));
        }
        if (!match && detail) {
          match = detail.publicAPI.some(s => s.name.toLowerCase().includes(q));
        }
        d3.select(this).select('circle')
          .attr('stroke', match ? '#00d4ff' : '#555')
          .attr('stroke-width', match ? 4 : 2)
          .attr('opacity', match ? 1 : 0.3);
        d3.select(this).select('text').attr('opacity', match ? 1 : 0.3);
      });
      link.attr('stroke-opacity', 0.15);
    });
  })();

  function kv(k, v) {
    return '<div class="panel-kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }

  // ============================================================
  // TAB 2: Dependency Explorer
  // ============================================================

  function initDepExplorer() {
    // Build adjacency maps
    const importsOf = new Map();
    const importedBy = new Map();
    for (const d of D.fileDeps) {
      if (!importsOf.has(d.s)) importsOf.set(d.s, []);
      importsOf.get(d.s).push({ file: d.t, name: d.n, type: d.y });
      if (!importedBy.has(d.t)) importedBy.set(d.t, []);
      importedBy.get(d.t).push({ file: d.s, name: d.n, type: d.y });
    }

    const fileMap = new Map(D.files.map(f => [f.p, f]));
    const select = $('#dep-file-select');

    // Calculate connection counts per file
    const fileDeps = D.files.map(f => ({
      ...f,
      imports: (importsOf.get(f.p) || []).length,
      consumers: (importedBy.get(f.p) || []).length,
      total: (importsOf.get(f.p) || []).length + (importedBy.get(f.p) || []).length,
    }));

    // Sort: connected files first (by total desc), then unconnected by module+path
    fileDeps.sort((a, b) => {
      if (a.total > 0 && b.total === 0) return -1;
      if (a.total === 0 && b.total > 0) return 1;
      if (a.total !== b.total) return b.total - a.total;
      return (a.m || '').localeCompare(b.m || '') || a.p.localeCompare(b.p);
    });

    // Add separator between connected and unconnected
    let addedSeparator = false;
    for (const f of fileDeps) {
      if (f.total === 0 && !addedSeparator) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.textContent = '── no dependencies ──────────────────';
        select.appendChild(sep);
        addedSeparator = true;
      }
      const opt = document.createElement('option');
      opt.value = f.p;
      const depInfo = f.total > 0 ? ' (' + (f.imports > 0 ? '\\u2191' + f.imports : '') + (f.imports > 0 && f.consumers > 0 ? ' ' : '') + (f.consumers > 0 ? '\\u2193' + f.consumers : '') + ')' : '';
      opt.textContent = (f.m ? '[' + f.m + '] ' : '') + f.p + depInfo;
      select.appendChild(opt);
    }

    select.addEventListener('change', function() {
      if (this.value) renderDepTree(this.value);
    });

    function renderDepTree(rootFile) {
      const rootMod = (fileMap.get(rootFile) || {}).m;

      // Build tree data (upstream = what this file imports)
      function buildTree(file, direction, depth, visited) {
        if (depth > 3 || visited.has(file)) return null;
        visited.add(file);
        const info = fileMap.get(file);
        const node = {
          name: basename(file),
          fullPath: file,
          module: info ? info.m : null,
          children: [],
          crossModule: info ? (info.m !== rootMod) : false,
        };
        const deps = direction === 'up' ? (importsOf.get(file) || []) : (importedBy.get(file) || []);
        for (const d of deps.slice(0, 20)) {
          const childFile = direction === 'up' ? d.file : d.file;
          const child = buildTree(childFile, direction, depth + 1, new Set(visited));
          if (child) {
            child.importName = d.name;
            node.children.push(child);
          }
        }
        return node;
      }

      renderTree('dep-upstream-svg', buildTree(rootFile, 'up', 0, new Set()), 'left');
      renderTree('dep-downstream-svg', buildTree(rootFile, 'down', 0, new Set()), 'right');
    }

    function renderTree(svgId, data, direction) {
      const svgEl = document.getElementById(svgId);
      const container = svgEl.parentElement;
      const W = container.clientWidth;
      const H = container.clientHeight - 30;
      d3.select('#' + svgId).selectAll('*').remove();

      if (!data || !data.children.length) {
        d3.select('#' + svgId).append('text')
          .attr('x', W/2).attr('y', H/2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#888').attr('font-size', '12px')
          .text('No ' + (direction === 'left' ? 'imports' : 'consumers'));
        return;
      }

      const svg = d3.select('#' + svgId);

      // Zoom/pan container — all content goes inside zoomG
      const zoomG = svg.append('g');
      const g = zoomG.append('g').attr('transform', 'translate(40, 20)');

      const root = d3.hierarchy(data);
      // Scale tree height based on node count for better spacing
      const nodeCount = root.descendants().length;
      const treeH = Math.max(H - 40, nodeCount * 28);
      const treeLayout = d3.tree().size([treeH, W - 100]);
      treeLayout(root);

      // Flip for left-to-right direction
      if (direction === 'right') {
        root.each(d => { d.y = W - 100 - d.y; });
      }

      // Links
      g.selectAll('.tree-link').data(root.links()).join('path')
        .attr('class', 'tree-link')
        .attr('d', d3.linkHorizontal().x(d => d.y).y(d => d.x))
        .attr('fill', 'none')
        .attr('stroke', d => d.target.data.crossModule ? '#ff6e40' : '#555')
        .attr('stroke-width', d => d.target.data.crossModule ? 2 : 1)
        .attr('stroke-opacity', 0.7);

      // Nodes
      const nodeG = g.selectAll('.tree-node').data(root.descendants()).join('g')
        .attr('class', 'tree-node')
        .attr('transform', d => 'translate(' + d.y + ',' + d.x + ')')
        .style('cursor', 'pointer');

      nodeG.append('circle')
        .attr('r', 5)
        .attr('fill', d => d.data.crossModule ? '#ff6e40' : '#00d4ff')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);

      nodeG.append('text')
        .attr('dx', d => d.children ? -8 : 8)
        .attr('dy', 4)
        .attr('text-anchor', d => d.children ? 'end' : 'start')
        .attr('fill', '#e0e0e0')
        .attr('font-size', '11px')
        .text(d => d.data.name + (d.data.module ? ' [' + d.data.module + ']' : ''));

      // Click node -> re-root
      nodeG.on('click', (evt, d) => {
        if (d.data.fullPath) {
          select.value = d.data.fullPath;
          renderDepTree(d.data.fullPath);
        }
      });

      // Hover
      nodeG.on('mouseover', function(evt, d) {
        showTooltip(evt, '<span class="tt-value">' + esc(d.data.fullPath) + '</span>' +
          (d.data.importName ? '<br><span class="tt-label">Import:</span> ' + esc(d.data.importName) : ''));
      }).on('mouseout', hideTooltip);

      // Enable zoom + pan on the SVG
      const zoom = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', (event) => { zoomG.attr('transform', event.transform); });
      svg.call(zoom);

      // Auto-fit: if tree is taller than viewport, scale down to fit
      if (treeH > H - 40) {
        const scale = Math.max(0.3, (H - 20) / (treeH + 40));
        const tx = direction === 'right' ? W * (1 - scale) : 0;
        svg.call(zoom.transform, d3.zoomIdentity.translate(tx, 0).scale(scale));
      }

      // Zoom hint
      if (!window._depZoomHintShown) {
        window._depZoomHintShown = true;
        const hint = svg.append('text')
          .attr('x', W/2).attr('y', H - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#666').attr('font-size', '10px')
          .text('Scroll to zoom \\u00B7 Drag to pan');
        setTimeout(() => hint.transition().duration(2000).attr('fill-opacity', 0).remove(), 4000);
      }
    }
  }

  // ============================================================
  // TAB 3: Hotspot Heatmap (D3 Treemap)
  // ============================================================

  function initHotspotHeatmap() {
    const container = document.getElementById('treemap-container');
    container.innerHTML = '';
    const W = container.clientWidth;
    const H = container.clientHeight || 600;

    if (!D.hotspots.length) {
      container.innerHTML = '<div class="empty-state">No hotspot data available.</div>';
      return;
    }

    // Group by module
    const byModule = new Map();
    for (const h of D.hotspots) {
      const mod = h.module || 'unknown';
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push(h);
    }

    const hierarchy = {
      name: 'root',
      children: [...byModule.entries()].map(([mod, files]) => ({
        name: mod,
        children: files.map(f => ({
          name: basename(f.path),
          fullPath: f.path,
          module: f.module,
          loc: f.loc || 1,
          changes_30d: f.changes_30d || 0,
          complexity_score: f.complexity_score || 0,
          risk_score: f.risk_score || 0,
        })),
      })),
    };

    const root = d3.hierarchy(hierarchy)
      .sum(d => d.loc || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap()
      .size([W, H])
      .padding(2)
      .paddingTop(18)
      .round(true)(root);

    const maxChurn = d3.max(D.hotspots, h => h.changes_30d) || 1;
    const churnColor = d3.scaleLinear()
      .domain([0, maxChurn * 0.3, maxChurn])
      .range(['#1e1e3a', '#8b3a00', '#ff1744']);

    // Module group labels
    for (const leaf of root.children || []) {
      const label = document.createElement('div');
      label.className = 'treemap-group-label';
      label.textContent = leaf.data.name;
      label.style.left = leaf.x0 + 'px';
      label.style.top = leaf.y0 + 'px';
      label.style.width = (leaf.x1 - leaf.x0) + 'px';
      container.appendChild(label);
    }

    // File cells
    for (const leaf of root.leaves()) {
      const d = leaf.data;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      if (w < 2 || h < 2) continue;

      const cell = document.createElement('div');
      cell.className = 'treemap-cell';
      cell.style.left = leaf.x0 + 'px';
      cell.style.top = leaf.y0 + 'px';
      cell.style.width = w + 'px';
      cell.style.height = h + 'px';
      cell.style.background = churnColor(d.changes_30d || 0);

      if (w > 30 && h > 16) {
        const label = document.createElement('div');
        label.className = 'cell-label';
        label.textContent = d.name;
        cell.appendChild(label);
      }

      cell.addEventListener('mouseover', evt => {
        showTooltip(evt, '<span class="tt-value">' + esc(d.fullPath) + '</span><br>' +
          '<span class="tt-label">LOC:</span> ' + (d.loc || 0) +
          ' | <span class="tt-label">Churn (30d):</span> ' + (d.changes_30d || 0) +
          ' | <span class="tt-label">Risk:</span> ' + (d.risk_score || 0).toFixed(1));
      });
      cell.addEventListener('mouseout', hideTooltip);

      cell.addEventListener('click', () => {
        let html = '<div class="panel-section"><h3>File Info</h3>';
        html += kv('Path', esc(d.fullPath));
        html += kv('Module', esc(d.module));
        html += kv('LOC', d.loc);
        html += kv('Complexity', (d.complexity_score || 0).toFixed(1));
        html += kv('Changes (30d)', d.changes_30d || 0);
        html += kv('Risk Score', (d.risk_score || 0).toFixed(1));
        html += '</div>';

        // Find in highChurn for more detail
        const churnEntry = D.highChurn.find(c => c.file === d.fullPath);
        if (churnEntry) {
          html += '<div class="panel-section"><h3>Change History</h3>';
          html += kv('7-day changes', churnEntry.changes_7d || 0);
          html += kv('30-day changes', churnEntry.changes_30d || 0);
          html += kv('90-day changes', churnEntry.changes_90d || 0);
          html += kv('Last changed', esc(churnEntry.last_changed));
          if (churnEntry.top_changers) {
            try {
              const changers = JSON.parse(churnEntry.top_changers);
              if (changers.length) {
                html += kv('Top authors', changers.join(', '));
              }
            } catch {}
          }
          html += '</div>';
        }

        openPanel(basename(d.fullPath), html);
      });

      container.appendChild(cell);
    }
  }

  // ============================================================
  // TAB 4: Capability Matrix
  // ============================================================

  function initCapabilityMatrix() {
    const container = document.getElementById('cap-matrix-container');
    container.innerHTML = '';

    if (!D.capabilities.length) {
      container.innerHTML = '<div class="empty-state">No capabilities detected.</div>';
      return;
    }

    const modules = [...new Set(D.capabilities.map(c => c.module_name))].sort();
    const caps = [...new Set(D.capabilities.map(c => c.capability))].sort();

    const lookup = new Map();
    for (const c of D.capabilities) {
      lookup.set(c.module_name + ':' + c.capability, { confidence: c.confidence, evidence: c.evidence });
    }

    const confColor = d3.scaleLinear()
      .domain([0, 0.3, 0.7, 1])
      .range(['#1a1a2e', '#1e3a1e', '#2d6a2d', '#00c853']);

    let html = '<table class="cap-matrix"><thead><tr><th></th>';
    for (const cap of caps) {
      html += '<th class="rotated">' + esc(cap) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (const mod of modules) {
      html += '<tr><td class="mod-name">' + esc(mod) + '</td>';
      for (const cap of caps) {
        const entry = lookup.get(mod + ':' + cap);
        if (entry) {
          const pct = (entry.confidence * 100).toFixed(0);
          html += '<td style="background:' + confColor(entry.confidence) + '" ';
          html += 'data-mod="' + esc(mod) + '" data-cap="' + esc(cap) + '" data-evidence="' + esc(entry.evidence) + '" data-conf="' + pct + '">';
          html += '<span class="cap-conf" style="color:rgba(255,255,255,' + Math.max(0.4, entry.confidence) + ')">' + pct + '</span>';
          html += '</td>';
        } else {
          html += '<td></td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Click cell -> evidence popup
    container.querySelectorAll('td[data-evidence]').forEach(td => {
      td.addEventListener('click', () => {
        const mod = td.dataset.mod;
        const cap = td.dataset.cap;
        const evidence = td.dataset.evidence;
        const conf = td.dataset.conf;

        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        const popup = document.createElement('div');
        popup.className = 'evidence-popup';
        popup.innerHTML = '<button class="close-btn">&times;</button>' +
          '<h3>' + esc(cap) + ' \\u2014 ' + esc(mod) + ' (' + conf + '%)</h3>' +
          '<div class="evidence-text">' + esc(evidence).replace(/;\\s*/g, '<br>') + '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        function closePopup() { overlay.remove(); popup.remove(); }
        overlay.addEventListener('click', closePopup);
        popup.querySelector('.close-btn').addEventListener('click', closePopup);
      });
    });
  }

  // ============================================================
  // TAB 5: Risk Register
  // ============================================================

  function initRiskRegister() {
    const container = document.getElementById('risk-container');
    container.innerHTML = '';

    const riskItems = [];

    // 1. High-consumer interfaces
    for (const iface of D.interfaces) {
      if ((iface.consumer_count || 0) > 5) {
        riskItems.push({
          item: iface.name,
          type: 'High-Consumer Interface',
          risk: iface.consumer_count > 15 ? 'CRITICAL' : iface.consumer_count > 10 ? 'HIGH' : 'MEDIUM',
          detail: iface.consumer_count + ' consumers, ' + esc(iface.kind || ''),
          metric: iface.consumer_count,
          file: iface.file,
          module: iface.module,
        });
      }
    }

    // 2. Hotspots
    for (const h of D.hotspots.slice(0, 30)) {
      const rs = h.risk_score || 0;
      if (rs > 5) {
        riskItems.push({
          item: basename(h.path),
          type: 'Hotspot',
          risk: rs > 20 ? 'HIGH' : rs > 10 ? 'MEDIUM' : 'LOW',
          detail: 'LOC=' + h.loc + ', complexity=' + (h.complexity_score||0).toFixed(1) + ', churn(30d)=' + (h.changes_30d||0),
          metric: rs,
          file: h.path,
          module: h.module,
        });
      }
    }

    // 3. Circular dependencies
    if (D.cycles && D.cycles.count > 0) {
      for (const [group, cycles] of Object.entries(D.cycles.byModule || {})) {
        riskItems.push({
          item: group,
          type: 'Circular Dependency',
          risk: 'HIGH',
          detail: cycles.length + ' cycle(s) between modules',
          metric: cycles.length * 10,
          file: cycles[0] ? cycles[0][0] : '',
          module: group,
        });
      }
    }

    // 4. Unstable modules
    for (const m of D.unstableModules) {
      riskItems.push({
        item: m.name,
        type: 'Unstable Module',
        risk: 'MEDIUM',
        detail: m.file_count + ' files, low stability',
        metric: m.file_count,
        file: '',
        module: m.name,
      });
    }

    if (!riskItems.length) {
      container.innerHTML = '<div class="empty-state">No risk items detected. Codebase looks clean!</div>';
      return;
    }

    // Sort by risk level (CRITICAL > HIGH > MEDIUM > LOW)
    const riskOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    riskItems.sort((a, b) => (riskOrder[a.risk] || 3) - (riskOrder[b.risk] || 3) || b.metric - a.metric);

    let sortCol = null;
    let sortDir = 1;

    function renderTable() {
      let html = '<table class="risk-table"><thead><tr>';
      const cols = ['Item', 'Type', 'Risk', 'Detail', 'Module'];
      for (const col of cols) {
        const arrow = sortCol === col ? (sortDir === 1 ? '\\u25B2' : '\\u25BC') : '';
        html += '<th data-col="' + col + '">' + col + '<span class="sort-arrow">' + arrow + '</span></th>';
      }
      html += '</tr></thead><tbody>';

      for (const r of riskItems) {
        html += '<tr class="risk-' + r.risk.toLowerCase() + '" data-file="' + esc(r.file) + '">';
        html += '<td>' + esc(r.item) + '</td>';
        html += '<td>' + esc(r.type) + '</td>';
        html += '<td><span class="risk-badge ' + r.risk + '">' + r.risk + '</span></td>';
        html += '<td>' + esc(r.detail) + '</td>';
        html += '<td>' + esc(r.module) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;

      // Sort handlers
      container.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.col;
          if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = 1; }
          riskItems.sort((a, b) => {
            let va, vb;
            switch (col) {
              case 'Item': va = a.item; vb = b.item; break;
              case 'Type': va = a.type; vb = b.type; break;
              case 'Risk': va = riskOrder[a.risk]; vb = riskOrder[b.risk]; break;
              case 'Detail': va = a.metric; vb = b.metric; break;
              case 'Module': va = a.module; vb = b.module; break;
              default: va = 0; vb = 0;
            }
            if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
            return ((va || 0) - (vb || 0)) * sortDir;
          });
          renderTable();
        });
      });

      // Click row -> side panel
      container.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const file = tr.dataset.file;
          const cells = tr.querySelectorAll('td');
          let html = '<div class="panel-section"><h3>Risk Item</h3>';
          html += kv('Item', cells[0].textContent);
          html += kv('Type', cells[1].textContent);
          html += kv('Risk Level', cells[2].textContent);
          html += kv('Module', cells[4].textContent);
          html += '</div>';
          html += '<div class="panel-section"><h3>Details</h3>';
          html += '<div style="font-size:12px;color:#ccc;line-height:1.6">' + esc(cells[3].textContent) + '</div>';
          if (file) html += '<div style="margin-top:8px;font-size:11px;color:#888">File: ' + esc(file) + '</div>';
          html += '</div>';
          openPanel(cells[0].textContent, html);
        });
      });
    }

    renderTable();
  }

  // ============================================================
  // Window resize handler
  // ============================================================
  window.addEventListener('resize', () => {
    if (activeTab === 'tab-hotspot-heatmap') {
      tabInited['tab-hotspot-heatmap'] = false;
      initHotspotHeatmap();
      tabInited['tab-hotspot-heatmap'] = true;
    }
  });

})();
`;
}

// ============================================================
// Build Full HTML Document
// ============================================================

/**
 * Build the complete self-contained HTML document.
 * @param {object} data - Dashboard data payload
 * @returns {string} Complete HTML string
 */
function buildHTML(data) {
  const vendorPath = path.join(__dirname, 'vendor', 'd3.v7.min.js');
  if (!fs.existsSync(vendorPath)) {
    throw new Error(
      `D3.js not found at ${vendorPath}.\n` +
      `Download it: curl -o "${vendorPath}" https://d3js.org/d3.v7.min.js`
    );
  }
  const d3Source = fs.readFileSync(vendorPath, 'utf-8');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A-Forge Code Graph \u2014 ${esc(data.projectName)}</title>
  <style>${generateCSS()}</style>
</head>
<body>
  ${generateHTML(data)}
  <script>${d3Source}</script>
  <script>window.__GRAPH_DATA__ = ${JSON.stringify(data)};</script>
  <script>${generateJS()}</script>
</body>
</html>`;
}

// ============================================================
// Browser Opening
// ============================================================

function openInBrowser(filePath) {
  const { exec } = require('child_process');
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start ""'
    : 'xdg-open';
  exec(`${cmd} "${filePath}"`, () => {});
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);

  function getArg(flag, def) {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def;
  }

  const root = getArg('--root', process.cwd());
  const dbPath = getArg('--db', path.join(root, '.forge', 'graph.db'));
  const outputPath = getArg('--output', path.join(root, '.forge', 'dashboard.html'));
  const shouldOpen = args.includes('--open');

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database not found: ${dbPath}`);
    console.error('Run /forge:init first to build the code graph.');
    process.exit(1);
  }

  console.log('');
  console.log('  A-Forge Dashboard Generator');
  console.log('  ───────────────────────────');
  console.log(`  Database: ${dbPath}`);

  const startTime = Date.now();
  const data = collectDashboardData(dbPath);
  const html = buildHTML(data);

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html, 'utf-8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const sizeKB = Math.round(html.length / 1024);
  console.log(`  Output:   ${outputPath}`);
  console.log(`  Size:     ${sizeKB} KB`);
  console.log(`  Modules:  ${data.moduleGraph.nodes.length}`);
  console.log(`  Files:    ${data.files.length}`);
  console.log(`  Time:     ${elapsed}s`);
  console.log('');

  if (shouldOpen) {
    openInBrowser(outputPath);
    console.log('  Opened in browser.');
    console.log('');
  }
}

if (require.main === module) {
  main();
}

module.exports = { collectDashboardData, buildHTML, shouldAutoRegenerate };
