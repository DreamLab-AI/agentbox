#!/usr/bin/env node
/**
 * FossFLOW Diagram Validator
 * Validates diagram JSON files against the FossFLOW schema
 */

const fs = require('fs');
const path = require('path');

// Schema definitions
const VALID_ICONS = [
  'isoflow__server', 'isoflow__database', 'isoflow__redis', 'isoflow__backup',
  'isoflow__api', 'isoflow__microservice', 'isoflow__authentication', 'isoflow__gateway',
  'isoflow__load_balancer', 'isoflow__cdn', 'isoflow__queue', 'isoflow__logs',
  'isoflow__person', 'isoflow__mobile', 'isoflow__web_app',
  'isoflow__monitoring', 'isoflow__analytics', 'isoflow__notification', 'isoflow__shield'
];

const VALID_STYLES = ['SOLID', 'DOTTED', 'DASHED'];
const VALID_LINE_TYPES = ['SINGLE', 'DOUBLE', 'DOUBLE_WITH_CIRCLE'];

/**
 * Validate a FossFLOW diagram
 */
function validateDiagram(diagram) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (!diagram.title || typeof diagram.title !== 'string') {
    errors.push('Missing or invalid "title" field (required string)');
  }

  if (!Array.isArray(diagram.items)) {
    errors.push('Missing or invalid "items" field (required array)');
    return { valid: false, errors, warnings };
  }

  if (!Array.isArray(diagram.connectors)) {
    errors.push('Missing or invalid "connectors" field (required array)');
  }

  if (!Array.isArray(diagram.colors)) {
    errors.push('Missing or invalid "colors" field (required array)');
  }

  // Collect IDs for reference validation
  const itemIds = new Set();
  const colorIds = new Set();
  const connectorIds = new Set();
  const positions = new Map();

  // Validate colors
  if (Array.isArray(diagram.colors)) {
    for (const color of diagram.colors) {
      if (!color.id) {
        errors.push('Color missing "id" field');
        continue;
      }
      if (colorIds.has(color.id)) {
        errors.push(`Duplicate color ID: "${color.id}"`);
      }
      colorIds.add(color.id);

      if (!color.value || !/^#[0-9A-Fa-f]{6}$/.test(color.value)) {
        errors.push(`Color "${color.id}" has invalid hex value: "${color.value}"`);
      }
    }
  }

  // Validate items
  for (let i = 0; i < diagram.items.length; i++) {
    const item = diagram.items[i];
    const itemPath = `items[${i}]`;

    if (!item.id) {
      errors.push(`${itemPath}: Missing "id" field`);
      continue;
    }

    if (itemIds.has(item.id)) {
      errors.push(`${itemPath}: Duplicate item ID "${item.id}"`);
    }
    itemIds.add(item.id);

    if (!item.name) {
      errors.push(`${itemPath}: Missing "name" field`);
    }

    if (!item.icon) {
      errors.push(`${itemPath}: Missing "icon" field`);
    } else if (!VALID_ICONS.includes(item.icon) && !item.icon.startsWith('custom__')) {
      warnings.push(`${itemPath}: Unknown icon "${item.icon}". Use isoflow__* icons or custom__* for custom icons.`);
    }

    if (!item.position || typeof item.position.x !== 'number' || typeof item.position.y !== 'number') {
      errors.push(`${itemPath}: Missing or invalid "position" field (requires {x: number, y: number})`);
    } else {
      const posKey = `${item.position.x},${item.position.y}`;
      if (positions.has(posKey)) {
        warnings.push(`${itemPath}: Position overlaps with item "${positions.get(posKey)}" at (${item.position.x}, ${item.position.y})`);
      }
      positions.set(posKey, item.id);
    }
  }

  // Validate connectors
  if (Array.isArray(diagram.connectors)) {
    for (let i = 0; i < diagram.connectors.length; i++) {
      const conn = diagram.connectors[i];
      const connPath = `connectors[${i}]`;

      if (!conn.id) {
        errors.push(`${connPath}: Missing "id" field`);
        continue;
      }

      if (connectorIds.has(conn.id)) {
        errors.push(`${connPath}: Duplicate connector ID "${conn.id}"`);
      }
      connectorIds.add(conn.id);

      if (!conn.from) {
        errors.push(`${connPath}: Missing "from" field`);
      } else if (!itemIds.has(conn.from)) {
        errors.push(`${connPath}: "from" references unknown item "${conn.from}"`);
      }

      if (!conn.to) {
        errors.push(`${connPath}: Missing "to" field`);
      } else if (!itemIds.has(conn.to)) {
        errors.push(`${connPath}: "to" references unknown item "${conn.to}"`);
      }

      if (!conn.color) {
        errors.push(`${connPath}: Missing "color" field`);
      } else if (!colorIds.has(conn.color) && !conn.customColor) {
        errors.push(`${connPath}: "color" references undefined color "${conn.color}"`);
      }

      if (conn.style && !VALID_STYLES.includes(conn.style)) {
        errors.push(`${connPath}: Invalid style "${conn.style}". Valid: ${VALID_STYLES.join(', ')}`);
      }

      if (conn.lineType && !VALID_LINE_TYPES.includes(conn.lineType)) {
        errors.push(`${connPath}: Invalid lineType "${conn.lineType}". Valid: ${VALID_LINE_TYPES.join(', ')}`);
      }

      if (conn.width && (typeof conn.width !== 'number' || conn.width < 1 || conn.width > 10)) {
        warnings.push(`${connPath}: Width should be between 1-10`);
      }

      // Validate labels
      if (conn.labels && Array.isArray(conn.labels)) {
        for (let j = 0; j < conn.labels.length; j++) {
          const label = conn.labels[j];
          const labelPath = `${connPath}.labels[${j}]`;

          if (!label.id) errors.push(`${labelPath}: Missing "id" field`);
          if (!label.text) errors.push(`${labelPath}: Missing "text" field`);
          if (typeof label.position !== 'number' || label.position < 0 || label.position > 100) {
            errors.push(`${labelPath}: Position must be 0-100`);
          }
        }
      }
    }
  }

  // Validate rectangles
  if (Array.isArray(diagram.rectangles)) {
    for (let i = 0; i < diagram.rectangles.length; i++) {
      const rect = diagram.rectangles[i];
      const rectPath = `rectangles[${i}]`;

      if (!rect.id) errors.push(`${rectPath}: Missing "id" field`);
      if (!rect.from || typeof rect.from.x !== 'number' || typeof rect.from.y !== 'number') {
        errors.push(`${rectPath}: Invalid "from" position`);
      }
      if (!rect.to || typeof rect.to.x !== 'number' || typeof rect.to.y !== 'number') {
        errors.push(`${rectPath}: Invalid "to" position`);
      }
      if (rect.color && !colorIds.has(rect.color)) {
        warnings.push(`${rectPath}: Unknown color "${rect.color}"`);
      }
    }
  }

  // Validate textBoxes
  if (Array.isArray(diagram.textBoxes)) {
    for (let i = 0; i < diagram.textBoxes.length; i++) {
      const tb = diagram.textBoxes[i];
      const tbPath = `textBoxes[${i}]`;

      if (!tb.id) errors.push(`${tbPath}: Missing "id" field`);
      if (!tb.text) errors.push(`${tbPath}: Missing "text" field`);
      if (!tb.position || typeof tb.position.x !== 'number' || typeof tb.position.y !== 'number') {
        errors.push(`${tbPath}: Invalid "position" field`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      items: itemIds.size,
      connectors: connectorIds.size,
      colors: colorIds.size,
      rectangles: diagram.rectangles?.length || 0,
      textBoxes: diagram.textBoxes?.length || 0
    }
  };
}

/**
 * Load and validate a diagram file
 */
function validateFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const diagram = JSON.parse(content);
    return validateDiagram(diagram);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { valid: false, errors: [`Invalid JSON: ${err.message}`], warnings: [] };
    }
    return { valid: false, errors: [`Failed to read file: ${err.message}`], warnings: [] };
  }
}

// CLI
if (require.main === module) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log(`
FossFLOW Diagram Validator

Usage: node validate-diagram.js <diagram.json>

Validates a FossFLOW diagram JSON file against the schema.
`);
    process.exit(1);
  }

  console.log(`\nValidating: ${filePath}\n`);

  const result = validateFile(filePath);

  if (result.errors.length > 0) {
    console.log('ERRORS:');
    result.errors.forEach(e => console.log(`  ❌ ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log('\nWARNINGS:');
    result.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  }

  if (result.stats) {
    console.log('\nSTATS:');
    console.log(`  Items: ${result.stats.items}`);
    console.log(`  Connectors: ${result.stats.connectors}`);
    console.log(`  Colors: ${result.stats.colors}`);
    console.log(`  Rectangles: ${result.stats.rectangles}`);
    console.log(`  TextBoxes: ${result.stats.textBoxes}`);
  }

  console.log(`\nResult: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n`);
  process.exit(result.valid ? 0 : 1);
}

module.exports = { validateDiagram, validateFile };
