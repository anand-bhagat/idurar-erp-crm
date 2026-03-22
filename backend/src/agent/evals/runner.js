#!/usr/bin/env node

/**
 * Eval Runner — Automated tool selection accuracy evaluation
 *
 * Sends each test case query through the LLM with the full tool set,
 * captures which tools the LLM selects, and scores against expected tools.
 *
 * Usage:
 *   node agent/evals/runner.js                     # Mock mode (no LLM needed)
 *   node agent/evals/runner.js --live               # Live mode (real LLM)
 *   node agent/evals/runner.js --baseline           # Save results as new baseline
 *   node agent/evals/runner.js --category=clients   # Run only one category
 *   node agent/evals/runner.js --verbose            # Show all case details
 */

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATASET_PATH = path.join(__dirname, 'dataset.json');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const EVALS_DIR = __dirname;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    live: false,
    baseline: false,
    verbose: false,
    category: null,
    model: null,
    provider: null,
  };

  for (const arg of args) {
    if (arg === '--live') opts.live = true;
    else if (arg === '--baseline') opts.baseline = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg.startsWith('--category=')) opts.category = arg.split('=')[1];
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1];
    else if (arg.startsWith('--provider=')) opts.provider = arg.split('=')[1];
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Tool registration with mock handlers
// ---------------------------------------------------------------------------

function registerAllToolsWithMocks() {
  const registry = require('../registry');
  registry.clearTools();

  // Load real tool definitions (schemas, descriptions, categories, access levels)
  // but replace backend handlers with mocks
  const toolModules = ['clients', 'invoices', 'payments', 'settings', 'admin', 'navigation'];

  for (const mod of toolModules) {
    const { toolDefinitions, register } = require(`../tools/${mod}`);

    // For navigation tools, register normally (they're frontend, no handler needed)
    // For backend tools, inject mock handlers
    const mockedDefs = {};
    for (const [name, def] of Object.entries(toolDefinitions)) {
      if (def.execution === 'backend') {
        mockedDefs[name] = {
          ...def,
          handler: async () => ({ success: true, data: { mock: true } }),
        };
      } else {
        mockedDefs[name] = def;
      }
    }

    // Register category from the module's register function
    // We call register() which handles both category and tools registration
    // But since we need mocked handlers, we register manually
    registry.registerTools(mockedDefs);
  }

  // Register categories
  registry.registerCategories({
    clients:
      'Client/customer management — search, list, get, create, update, delete clients. Also navigate to customers page.',
    invoices:
      'Invoice management — search, list, get, create, update, delete invoices. Also navigate to invoices page.',
    payments:
      'Payment management — search, list, get, create, update, delete payments. Also navigate to payments page.',
    settings:
      'Application settings — get, list, update single or batch settings. Also navigate to settings page.',
    admin: 'Admin user profiles — get and update admin profile. Also navigate to profile page.',
    navigation:
      'Page navigation — navigate to dashboard, settings, profile, login, and other application pages.',
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildEvalPrompt(userContext) {
  const promptBuilder = require('../llm/prompt-builder');
  const registry = require('../registry');
  const toolDefs = registry.getToolDefinitions(userContext.role);
  const systemPrompt = promptBuilder.buildSystemPrompt({
    appName: 'IDURAR ERP/CRM',
    appDescription: 'Open-source ERP/CRM application for managing clients, invoices, and payments.',
    userContext,
    toolDefinitions: toolDefs,
  });
  return { systemPrompt, toolDefs };
}

// ---------------------------------------------------------------------------
// Mock LLM adapter for offline eval
// ---------------------------------------------------------------------------

class ScriptedEvalAdapter {
  constructor(dataset) {
    this._dataset = dataset;
    this._currentQuery = null;
    this._callCount = 0;
  }

  setQuery(query) {
    this._currentQuery = query;
    this._callCount = 0;
  }

  async chat(messages, tools) {
    this._callCount++;

    // Find the test case for current query
    const testCase = this._dataset.find((tc) => tc.query === this._currentQuery);

    // First call: return expected tool calls
    if (this._callCount === 1 && testCase && testCase.expectedTools.length > 0) {
      const toolCalls = testCase.expectedTools.map((toolName, i) => ({
        id: `eval-call-${i}`,
        name: toolName,
        params: {},
      }));

      return {
        content: null,
        toolCalls,
        usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 },
      };
    }

    // Subsequent calls or no-tool cases: return text response
    return {
      content: 'Eval response.',
      toolCalls: null,
      usage: { inputTokens: 50, outputTokens: 20, cachedTokens: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Live LLM adapter creation
// ---------------------------------------------------------------------------

async function createLiveAdapter(opts) {
  const config = require('../config');
  const llmFactory = require('../llm');

  const provider = opts.provider || config.llm.provider;
  const model = opts.model || config.llm.model;

  return llmFactory.createAdapter({
    provider,
    model,
    temperature: 0, // Deterministic for evals
    apiKey: process.env.LLM_API_KEY || config.llm.apiKey,
    baseURL: process.env.LLM_BASE_URL || config.llm.baseURL,
  });
}

// ---------------------------------------------------------------------------
// Single eval case execution
// ---------------------------------------------------------------------------

async function runEvalCase(testCase, adapter, systemPrompt, toolDefs) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: testCase.query },
  ];

  try {
    const response = await adapter.chat(messages, toolDefs);
    const actualTools = [];

    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        actualTools.push(tc.name);
      }
    }

    return { actualTools, error: null };
  } catch (err) {
    return { actualTools: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single eval case.
 *
 * @returns {{ score: string, details: string }}
 *   score: 'exact_match' | 'partial_match' | 'miss' | 'hallucination' | 'pass_no_tools'
 */
function scoreCase(testCase, actualTools) {
  const expected = testCase.expectedTools;
  const forbidden = testCase.forbiddenTools || [];

  // Check for hallucinated tools (non-existent tools)
  const registry = require('../registry');
  const allToolNames = new Set(registry.getToolNames());
  const hallucinated = actualTools.filter((t) => !allToolNames.has(t));
  if (hallucinated.length > 0) {
    return {
      score: 'hallucination',
      details: `Called non-existent tools: ${hallucinated.join(', ')}`,
    };
  }

  // Check for forbidden tool calls
  const forbiddenCalled = actualTools.filter((t) => forbidden.includes(t));
  if (forbiddenCalled.length > 0) {
    return {
      score: 'miss',
      details: `Called forbidden tools: ${forbiddenCalled.join(', ')}`,
    };
  }

  // No tools expected, no tools called
  if (expected.length === 0 && actualTools.length === 0) {
    return { score: 'pass_no_tools', details: 'Correctly called no tools' };
  }

  // No tools expected but tools were called
  if (expected.length === 0 && actualTools.length > 0) {
    return {
      score: 'miss',
      details: `Expected no tools but called: ${actualTools.join(', ')}`,
    };
  }

  // Tools expected but none called
  if (expected.length > 0 && actualTools.length === 0) {
    return {
      score: 'miss',
      details: `Expected [${expected.join(', ')}] but called no tools`,
    };
  }

  // Compare tool sets
  const expectedSet = new Set(expected);
  const actualSet = new Set(actualTools);

  const correctTools = actualTools.filter((t) => expectedSet.has(t));
  const extraTools = actualTools.filter((t) => !expectedSet.has(t));
  const missingTools = expected.filter((t) => !actualSet.has(t));

  // Exact match: same tools, and if sequence matters, same order
  if (missingTools.length === 0 && extraTools.length === 0) {
    if (testCase.sequenceMatters) {
      // Check order
      const orderCorrect = expected.every((t, i) => actualTools[i] === t);
      if (orderCorrect) {
        return { score: 'exact_match', details: 'All tools correct, order correct' };
      }
      return {
        score: 'partial_match',
        details: `Right tools, wrong order. Expected: [${expected.join(', ')}], Got: [${actualTools.join(', ')}]`,
      };
    }
    return { score: 'exact_match', details: 'All tools correct' };
  }

  // Partial match: at least one correct tool
  if (correctTools.length > 0) {
    const parts = [];
    if (missingTools.length > 0) parts.push(`missing: [${missingTools.join(', ')}]`);
    if (extraTools.length > 0) parts.push(`extra: [${extraTools.join(', ')}]`);
    return {
      score: 'partial_match',
      details: `Partial — correct: [${correctTools.join(', ')}], ${parts.join(', ')}`,
    };
  }

  // Miss: no correct tools at all
  return {
    score: 'miss',
    details: `Expected [${expected.join(', ')}], got [${actualTools.join(', ')}]`,
  };
}

// ---------------------------------------------------------------------------
// Per-tool precision / recall / confusion tracking
// ---------------------------------------------------------------------------

class ToolAccuracyTracker {
  constructor() {
    // For each tool: how many times it should have been called vs was called
    this.expectedCounts = {}; // tool -> count of cases where it was expected
    this.calledCounts = {}; // tool -> count of cases where it was actually called
    this.truePositives = {}; // tool -> correctly called
    this.falsePositives = {}; // tool -> called when not expected
    this.falseNegatives = {}; // tool -> expected but not called
    this.confusionPairs = {}; // "expected->actual" -> count
  }

  record(testCase, actualTools) {
    const expectedSet = new Set(testCase.expectedTools);
    const actualSet = new Set(actualTools);

    for (const tool of testCase.expectedTools) {
      this.expectedCounts[tool] = (this.expectedCounts[tool] || 0) + 1;
      if (actualSet.has(tool)) {
        this.truePositives[tool] = (this.truePositives[tool] || 0) + 1;
      } else {
        this.falseNegatives[tool] = (this.falseNegatives[tool] || 0) + 1;
      }
    }

    for (const tool of actualTools) {
      this.calledCounts[tool] = (this.calledCounts[tool] || 0) + 1;
      if (!expectedSet.has(tool)) {
        this.falsePositives[tool] = (this.falsePositives[tool] || 0) + 1;
      }
    }

    // Track confusion: for each expected tool that was missed, record what was called instead
    for (const expected of testCase.expectedTools) {
      if (!actualSet.has(expected)) {
        for (const actual of actualTools) {
          if (!expectedSet.has(actual)) {
            const key = `${expected} -> ${actual}`;
            this.confusionPairs[key] = (this.confusionPairs[key] || 0) + 1;
          }
        }
      }
    }
  }

  getReport() {
    const allTools = new Set([
      ...Object.keys(this.expectedCounts),
      ...Object.keys(this.calledCounts),
    ]);

    const toolMetrics = {};
    for (const tool of allTools) {
      const tp = this.truePositives[tool] || 0;
      const fp = this.falsePositives[tool] || 0;
      const fn = this.falseNegatives[tool] || 0;

      const precision = tp + fp > 0 ? tp / (tp + fp) : null;
      const recall = tp + fn > 0 ? tp / (tp + fn) : null;
      const f1 = precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;

      toolMetrics[tool] = {
        expectedCount: this.expectedCounts[tool] || 0,
        calledCount: this.calledCounts[tool] || 0,
        truePositives: tp,
        falsePositives: fp,
        falseNegatives: fn,
        precision: precision !== null ? Math.round(precision * 1000) / 1000 : null,
        recall: recall !== null ? Math.round(recall * 1000) / 1000 : null,
        f1: f1 !== null ? Math.round(f1 * 1000) / 1000 : null,
      };
    }

    // Sort confusion pairs by frequency
    const confusionList = Object.entries(this.confusionPairs)
      .sort((a, b) => b[1] - a[1])
      .map(([pair, count]) => ({ pair, count }));

    return { toolMetrics, confusionPairs: confusionList };
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printSummary(results, opts) {
  const total = results.length;
  const scores = { exact_match: 0, partial_match: 0, miss: 0, hallucination: 0, pass_no_tools: 0 };
  const byCategory = {};
  const byDifficulty = {};
  const failures = [];

  for (const r of results) {
    scores[r.score]++;

    // By category
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, pass: 0 };
    }
    byCategory[r.category].total++;
    if (r.score === 'exact_match' || r.score === 'pass_no_tools') {
      byCategory[r.category].pass++;
    }

    // By difficulty
    if (!byDifficulty[r.difficulty]) {
      byDifficulty[r.difficulty] = { total: 0, pass: 0 };
    }
    byDifficulty[r.difficulty].total++;
    if (r.score === 'exact_match' || r.score === 'pass_no_tools') {
      byDifficulty[r.difficulty].pass++;
    }

    // Collect failures
    if (r.score !== 'exact_match' && r.score !== 'pass_no_tools') {
      failures.push(r);
    }
  }

  const passCount = scores.exact_match + scores.pass_no_tools;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';

  console.log('\n' + '='.repeat(70));
  console.log('  EVAL RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total cases:     ${total}`);
  console.log(`  Pass rate:       ${passRate}% (${passCount}/${total})`);
  console.log(`  Exact match:     ${scores.exact_match}`);
  console.log(`  Pass (no tools): ${scores.pass_no_tools}`);
  console.log(`  Partial match:   ${scores.partial_match}`);
  console.log(`  Miss:            ${scores.miss}`);
  console.log(`  Hallucination:   ${scores.hallucination}`);

  console.log('\n' + '-'.repeat(70));
  console.log('  PER-CATEGORY ACCURACY');
  console.log('-'.repeat(70));
  for (const [cat, data] of Object.entries(byCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
    const pct = ((data.pass / data.total) * 100).toFixed(1);
    const bar = '#'.repeat(Math.round(data.pass / data.total * 20));
    console.log(`  ${cat.padEnd(15)} ${pct.padStart(6)}%  ${bar}  (${data.pass}/${data.total})`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('  PER-DIFFICULTY ACCURACY');
  console.log('-'.repeat(70));
  for (const [diff, data] of Object.entries(byDifficulty)) {
    const pct = ((data.pass / data.total) * 100).toFixed(1);
    console.log(`  ${diff.padEnd(10)} ${pct.padStart(6)}%  (${data.pass}/${data.total})`);
  }

  // Failures
  if (failures.length > 0) {
    console.log('\n' + '-'.repeat(70));
    console.log(`  FAILURES (${failures.length})`);
    console.log('-'.repeat(70));
    for (const f of failures) {
      console.log(`  [${f.score.toUpperCase()}] ${f.id}: ${f.query}`);
      console.log(`    Expected: [${f.expectedTools.join(', ')}]`);
      console.log(`    Actual:   [${f.actualTools.join(', ')}]`);
      console.log(`    Details:  ${f.details}`);
      console.log('');
    }
  }

  if (opts.verbose) {
    console.log('\n' + '-'.repeat(70));
    console.log('  ALL RESULTS');
    console.log('-'.repeat(70));
    for (const r of results) {
      const icon = r.score === 'exact_match' || r.score === 'pass_no_tools' ? 'PASS' : 'FAIL';
      console.log(`  [${icon}] ${r.id}: ${r.score} — ${r.query.substring(0, 60)}`);
    }
  }

  console.log('\n' + '='.repeat(70));

  return { total, passCount, passRate: parseFloat(passRate), scores, byCategory, byDifficulty };
}

function printToolAccuracyReport(tracker) {
  const report = tracker.getReport();

  console.log('\n' + '='.repeat(70));
  console.log('  TOOL SELECTION ACCURACY REPORT');
  console.log('='.repeat(70));

  console.log('\n  Per-Tool Precision & Recall:');
  console.log('  ' + '-'.repeat(68));
  console.log(
    '  ' +
      'Tool'.padEnd(28) +
      'Prec'.padStart(7) +
      'Rec'.padStart(7) +
      'F1'.padStart(7) +
      'TP'.padStart(5) +
      'FP'.padStart(5) +
      'FN'.padStart(5)
  );
  console.log('  ' + '-'.repeat(68));

  const { toolMetrics, confusionPairs } = report;

  for (const [tool, m] of Object.entries(toolMetrics).sort((a, b) => a[0].localeCompare(b[0]))) {
    const prec = m.precision !== null ? (m.precision * 100).toFixed(0) + '%' : 'N/A';
    const rec = m.recall !== null ? (m.recall * 100).toFixed(0) + '%' : 'N/A';
    const f1 = m.f1 !== null ? (m.f1 * 100).toFixed(0) + '%' : 'N/A';

    console.log(
      '  ' +
        tool.padEnd(28) +
        prec.padStart(7) +
        rec.padStart(7) +
        f1.padStart(7) +
        String(m.truePositives).padStart(5) +
        String(m.falsePositives).padStart(5) +
        String(m.falseNegatives).padStart(5)
    );
  }

  if (confusionPairs.length > 0) {
    console.log('\n  Tool Confusion Pairs (expected -> actually called):');
    console.log('  ' + '-'.repeat(68));
    for (const { pair, count } of confusionPairs) {
      console.log(`  ${pair.padEnd(50)} x${count}`);
    }
  } else {
    console.log('\n  No tool confusions detected.');
  }

  console.log('\n' + '='.repeat(70));

  return report;
}

// ---------------------------------------------------------------------------
// Baseline management
// ---------------------------------------------------------------------------

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveBaseline(summary, toolReport, model) {
  const baseline = {
    date: new Date().toISOString(),
    model: model || 'mock',
    systemPromptVersion: '1.0',
    passRate: summary.passRate,
    total: summary.total,
    passCount: summary.passCount,
    scores: summary.scores,
    byCategory: summary.byCategory,
    byDifficulty: summary.byDifficulty,
    toolMetrics: toolReport.toolMetrics,
  };

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`\n  Baseline saved to ${BASELINE_PATH}`);
  return baseline;
}

function compareBaseline(currentSummary, baseline) {
  console.log('\n' + '='.repeat(70));
  console.log('  REGRESSION CHECK (vs baseline)');
  console.log('='.repeat(70));
  console.log(`  Baseline date:  ${baseline.date}`);
  console.log(`  Baseline model: ${baseline.model}`);

  const baselineRate = baseline.passRate;
  const currentRate = currentSummary.passRate;
  const delta = currentRate - baselineRate;

  console.log(`  Baseline rate:  ${baselineRate}%`);
  console.log(`  Current rate:   ${currentRate}%`);
  console.log(`  Delta:          ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);

  const regressions = [];

  // Overall regression check (>5% drop)
  if (delta < -5) {
    regressions.push(`Overall pass rate dropped by ${Math.abs(delta).toFixed(1)}% (threshold: 5%)`);
  }

  // Per-category regression check
  for (const [cat, current] of Object.entries(currentSummary.byCategory)) {
    const base = baseline.byCategory[cat];
    if (!base) continue;

    const baseRate = (base.pass / base.total) * 100;
    const curRate = (current.pass / current.total) * 100;
    const catDelta = curRate - baseRate;

    if (catDelta < -5) {
      regressions.push(
        `Category "${cat}" dropped by ${Math.abs(catDelta).toFixed(1)}% (${baseRate.toFixed(1)}% -> ${curRate.toFixed(1)}%)`
      );
    }
  }

  if (regressions.length > 0) {
    console.log('\n  REGRESSIONS DETECTED:');
    for (const reg of regressions) {
      console.log(`    [!] ${reg}`);
    }
    console.log('\n' + '='.repeat(70));
    return false;
  }

  console.log('\n  No regressions detected (threshold: 5%).');
  console.log('='.repeat(70));
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log('Loading eval dataset...');
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  console.log(`Loaded ${dataset.length} test cases.`);

  // Filter by category if specified
  let testCases = dataset;
  if (opts.category) {
    testCases = dataset.filter((tc) => tc.category === opts.category);
    console.log(`Filtered to ${testCases.length} cases in category: ${opts.category}`);
  }

  if (testCases.length === 0) {
    console.error('No test cases to run.');
    process.exit(1);
  }

  // Register tools
  console.log('Registering tools with mock handlers...');
  registerAllToolsWithMocks();

  // Create adapter
  let adapter;
  let modelName = 'mock';
  if (opts.live) {
    console.log('Creating live LLM adapter...');
    adapter = await createLiveAdapter(opts);
    modelName = opts.model || 'default';
  } else {
    console.log('Using scripted mock adapter (offline mode).');
    adapter = new ScriptedEvalAdapter(dataset);
  }

  // Build prompt
  const defaultContext = {
    userId: '507f1f77bcf86cd799439011',
    role: 'owner',
    name: 'Eval User',
  };
  const { systemPrompt, toolDefs } = buildEvalPrompt(defaultContext);

  // Run cases
  console.log(`\nRunning ${testCases.length} eval cases...\n`);

  const results = [];
  const tracker = new ToolAccuracyTracker();

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];

    // For scripted adapter, set current query
    if (adapter instanceof ScriptedEvalAdapter) {
      adapter.setQuery(tc.query);
    }

    // Build per-case context with correct role
    const caseContext = { ...defaultContext, role: tc.role || 'owner' };
    const caseBuild = buildEvalPrompt(caseContext);

    const { actualTools, error } = await runEvalCase(tc, adapter, caseBuild.systemPrompt, caseBuild.toolDefs);

    const { score, details } = scoreCase(tc, actualTools);

    tracker.record(tc, actualTools);

    const result = {
      id: tc.id,
      query: tc.query,
      category: tc.category,
      difficulty: tc.difficulty,
      expectedTools: tc.expectedTools,
      actualTools,
      score,
      details,
      error,
    };
    results.push(result);

    // Progress indicator
    const icon = score === 'exact_match' || score === 'pass_no_tools' ? '.' : 'F';
    process.stdout.write(icon);
  }

  console.log(''); // newline after progress dots

  // Print results
  const summary = printSummary(results, opts);
  const toolReport = printToolAccuracyReport(tracker);

  // Baseline comparison
  const baseline = loadBaseline();
  if (baseline && !opts.baseline) {
    compareBaseline(summary, baseline);
  }

  // Save baseline if requested
  if (opts.baseline) {
    saveBaseline(summary, toolReport, modelName);
  }

  // Exit with error code if pass rate < 80%
  if (summary.passRate < 80) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});

// Export for testing
module.exports = {
  scoreCase,
  ToolAccuracyTracker,
  ScriptedEvalAdapter,
  registerAllToolsWithMocks,
  compareBaseline,
  parseArgs,
};
