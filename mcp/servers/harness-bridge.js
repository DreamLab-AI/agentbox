#!/usr/bin/env node
// harness-bridge.js — MCP server providing harness template inspection tools
// for agents.  Agents use these tools to discover, inspect, validate against,
// and audit harness templates that define guide/sensor pairing discipline
// per topology.
//
// Templates are read lazily from disk on every call so that external updates
// (janitor, manual edits) are picked up immediately.
//
// Environment:
//   HARNESS_TEMPLATE_DIR — directory containing template JSON files
//                          (default: /var/lib/agentbox/harness-templates)
//   VISIONFLOW_DOCS_DIR  — path to VisionFlow engineering docs
//                          (default: /home/devuser/workspace/VisionFlow/docs/engineering)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATE_DIR = process.env.HARNESS_TEMPLATE_DIR || '/var/lib/agentbox/harness-templates';
const DOCS_DIR = process.env.VISIONFLOW_DOCS_DIR || '/home/devuser/workspace/VisionFlow/docs/engineering';
const SCHEMA_PATH = path.join(DOCS_DIR, 'schemas', 'harness-template.schema.json');

// ── schema validation ──────────────────────────────────────────────────────
// Attempt to use Ajv for full JSON Schema validation; fall back to manual
// required-field checks when Ajv is unavailable.

let _ajvValidate = null;

// Eagerly try to load Ajv at module level (sync path via createRequire).
// Falls back to manual validation when Ajv or the schema file is unavailable.
try {
  const { createRequire } = await import('node:module');
  const _require = createRequire(import.meta.url);
  const Ajv = _require('ajv');
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  _ajvValidate = ajv.compile(schema);
  console.error('[harness-bridge] Ajv schema validation enabled');
} catch {
  _ajvValidate = null;
  console.error('[harness-bridge] Ajv or schema unavailable — using manual validation');
}

// ── template loading ───────────────────────────────────────────────────────

/**
 * Read and parse all .json template files from TEMPLATE_DIR.
 * Returns { templates: Template[], warnings: string[] }.
 * Never throws — returns empty results if directory is missing.
 */
function loadTemplates() {
  const warnings = [];

  if (!fs.existsSync(TEMPLATE_DIR)) {
    warnings.push(`Template directory does not exist: ${TEMPLATE_DIR}`);
    return { templates: [], warnings };
  }

  let files;
  try {
    files = fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.json'));
  } catch (err) {
    warnings.push(`Cannot read template directory: ${err.message}`);
    return { templates: [], warnings };
  }

  const templates = [];
  for (const file of files) {
    const filePath = path.join(TEMPLATE_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Validate
      const validationResult = validateTemplate(parsed, file);
      if (validationResult.error) {
        warnings.push(`Skipping ${file}: ${validationResult.error}`);
        continue;
      }

      templates.push(parsed);
    } catch (err) {
      warnings.push(`Skipping ${file}: ${err.message}`);
    }
  }

  return { templates, warnings };
}

/**
 * Validate a template object. Returns { error?: string }.
 * Uses Ajv when available, otherwise checks required fields manually.
 */
function validateTemplate(template, filename) {
  if (_ajvValidate) {
    const valid = _ajvValidate(template);
    if (!valid) {
      const errors = _ajvValidate.errors.map(e => `${e.instancePath} ${e.message}`).join('; ');
      return { error: `Schema validation failed: ${errors}` };
    }
    return {};
  }

  // Manual required-field validation
  if (!template || typeof template !== 'object') {
    return { error: 'Template is not an object' };
  }
  for (const field of ['topology', 'version', 'structure', 'guides', 'sensors', 'pairings']) {
    if (template[field] === undefined || template[field] === null) {
      return { error: `Missing required field: ${field}` };
    }
  }
  if (typeof template.topology !== 'string' || template.topology.length === 0) {
    return { error: 'topology must be a non-empty string' };
  }
  if (typeof template.version !== 'string') {
    return { error: 'version must be a string' };
  }
  if (!Array.isArray(template.guides)) {
    return { error: 'guides must be an array' };
  }
  if (!Array.isArray(template.sensors)) {
    return { error: 'sensors must be an array' };
  }
  if (!Array.isArray(template.pairings)) {
    return { error: 'pairings must be an array' };
  }
  if (!template.structure || typeof template.structure !== 'object') {
    return { error: 'structure must be an object' };
  }
  if (!Array.isArray(template.structure.substrates)) {
    return { error: 'structure.substrates must be an array' };
  }
  return {};
}

// ── computed fields ────────────────────────────────────────────────────────

/**
 * Compute pairing analysis for a template.
 * Returns { pairing_ratio, unpaired_guides, unpaired_sensors, coverage_summary }.
 */
function computePairingAnalysis(template) {
  const guideIds = new Set((template.guides || []).map(g => g.id));
  const sensorIds = new Set((template.sensors || []).map(s => s.id));

  const pairedGuideIds = new Set();
  const pairedSensorIds = new Set();

  for (const p of (template.pairings || [])) {
    if (guideIds.has(p.guide_id)) pairedGuideIds.add(p.guide_id);
    if (sensorIds.has(p.sensor_id)) pairedSensorIds.add(p.sensor_id);
  }

  const unpairedGuides = [...guideIds].filter(id => !pairedGuideIds.has(id));
  const unpairedSensors = [...sensorIds].filter(id => !pairedSensorIds.has(id));

  const guidesTotal = guideIds.size;
  const sensorsTotal = sensorIds.size;
  const denominator = Math.max(guidesTotal, sensorsTotal);
  const pairingRatio = denominator > 0
    ? (template.pairings || []).length / denominator
    : 0;

  const coverageSummary = `${pairedGuideIds.size}/${guidesTotal} guides paired, ${pairedSensorIds.size}/${sensorsTotal} sensors paired`;

  return {
    pairing_ratio: Math.round(pairingRatio * 1000) / 1000,
    unpaired_guides: unpairedGuides,
    unpaired_sensors: unpairedSensors,
    coverage_summary: coverageSummary,
  };
}

// ── validation helpers ─────────────────────────────────────────────────────

function validateString(value, name, maxLen = 1024) {
  if (typeof value !== 'string' || value.length === 0) {
    return { error: 'validation_error', message: `${name} must be a non-empty string` };
  }
  if (value.length > maxLen) {
    return { error: 'validation_error', message: `${name} exceeds max length of ${maxLen}` };
  }
  return null;
}

// ── tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'harness_list',
    description: 'List all registered harness templates with summary metadata including pairing ratios. Optionally filter by maturity level.',
    inputSchema: {
      type: 'object',
      properties: {
        maturity_filter: {
          type: 'string',
          enum: ['planned', 'scaffolded', 'standalone', 'integrated', 'verified'],
          description: 'Optional filter by maturity level',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'harness_inspect',
    description: 'Return the full harness template for a given topology, including computed pairing analysis (unpaired guides/sensors, coverage summary).',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          description: 'Topology name to inspect (e.g. governance-decision)',
        },
      },
      required: ['topology'],
      additionalProperties: false,
    },
  },
  {
    name: 'harness_validate',
    description: 'Validate whether agent output conforms to the active harness template guide constraints. Checks required substrates and blocked patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          description: 'Topology name identifying the harness template to validate against',
        },
        output_summary: {
          type: 'string',
          description: 'Summary of agent output to validate against guide constraints',
        },
      },
      required: ['topology', 'output_summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'harness_audit',
    description: 'Run a pairing audit across all harness templates. Returns per-topology breakdown and summary statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Include unpaired guide/sensor IDs in output (default: false)',
        },
      },
      additionalProperties: false,
    },
  },
];

// ── tool handlers ──────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'harness_list': {
      const { templates, warnings } = loadTemplates();

      let filtered = templates;
      if (args.maturity_filter) {
        filtered = templates.filter(t => t.maturity === args.maturity_filter);
      }

      const items = filtered.map(t => {
        const analysis = computePairingAnalysis(t);
        return {
          topology: t.topology,
          version: t.version,
          maturity: t.maturity || 'unknown',
          substrates: (t.structure && t.structure.substrates) || [],
          guide_count: (t.guides || []).length,
          sensor_count: (t.sensors || []).length,
          pairing_ratio: analysis.pairing_ratio,
        };
      });

      const result = { templates: items };
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    }

    case 'harness_inspect': {
      const topErr = validateString(args.topology, 'topology', 256);
      if (topErr) return topErr;

      const { templates, warnings } = loadTemplates();
      const template = templates.find(t => t.topology === args.topology);

      if (!template) {
        return {
          error: 'not_found',
          message: `No template found for topology: ${args.topology}`,
          available: templates.map(t => t.topology),
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }

      const computed = computePairingAnalysis(template);

      const result = { ...template, computed };
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    }

    case 'harness_validate': {
      const topErr = validateString(args.topology, 'topology', 256);
      if (topErr) return topErr;
      const outErr = validateString(args.output_summary, 'output_summary', 16384);
      if (outErr) return outErr;

      const { templates, warnings } = loadTemplates();
      const template = templates.find(t => t.topology === args.topology);

      if (!template) {
        return {
          error: 'not_found',
          message: `No template found for topology: ${args.topology}`,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }

      const violations = [];
      const summary = args.output_summary.toLowerCase();

      // Check required substrates — guides with required_substrates or
      // applies_to fields that should be mentioned
      for (const guide of (template.guides || [])) {
        const requiredSubstrates = guide.required_substrates || [];
        for (const substrate of requiredSubstrates) {
          if (!summary.includes(substrate.toLowerCase())) {
            violations.push(`Guide "${guide.id}": required substrate "${substrate}" not addressed in output`);
          }
        }

        // Check blocked patterns
        const blockedPatterns = guide.blocked_patterns || [];
        for (const pattern of blockedPatterns) {
          if (summary.includes(pattern.toLowerCase())) {
            violations.push(`Guide "${guide.id}": blocked pattern "${pattern}" detected in output`);
          }
        }
      }

      // Check structure.substrates — the topology's required substrates
      // should generally be referenced
      const requiredStructuralSubstrates = (template.structure && template.structure.substrates) || [];
      const missingSubstrates = requiredStructuralSubstrates.filter(
        s => !summary.includes(s.toLowerCase())
      );
      if (missingSubstrates.length > 0) {
        violations.push(`Topology substrates not addressed: ${missingSubstrates.join(', ')}`);
      }

      const result = {
        compliant: violations.length === 0,
        violations,
        template_version: template.version,
      };
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    }

    case 'harness_audit': {
      const verbose = args.verbose === true;
      const { templates, warnings } = loadTemplates();

      const audit = [];
      let totalRatio = 0;

      for (const t of templates) {
        const analysis = computePairingAnalysis(t);
        const entry = {
          topology: t.topology,
          guides_total: (t.guides || []).length,
          sensors_total: (t.sensors || []).length,
          paired: (t.pairings || []).length,
          ratio: analysis.pairing_ratio,
          maturity: t.maturity || 'unknown',
        };

        if (verbose) {
          entry.unpaired_guides = analysis.unpaired_guides;
          entry.unpaired_sensors = analysis.unpaired_sensors;
        }

        audit.push(entry);
        totalRatio += analysis.pairing_ratio;
      }

      const avgRatio = templates.length > 0
        ? Math.round((totalRatio / templates.length) * 100)
        : 0;

      const result = {
        audit,
        summary: `${templates.length} templates, ${avgRatio}% average pairing ratio`,
      };
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

// ── MCP server wiring ──────────────────────────────────────────────────────

const server = new Server(
  { name: 'harness-bridge', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args || {});
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[harness-bridge] Connected to MCP, template_dir=${TEMPLATE_DIR}`);
