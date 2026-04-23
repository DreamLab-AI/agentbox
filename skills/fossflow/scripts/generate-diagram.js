#!/usr/bin/env node
/**
 * FossFLOW Diagram Generator
 * Standalone tool for creating isometric diagram JSON files
 */

const fs = require('fs');
const path = require('path');

// Icon definitions (standalone - no external deps)
const ICONS = {
  // Infrastructure
  'isoflow__server': { name: 'Server', category: 'infrastructure' },
  'isoflow__database': { name: 'Database', category: 'infrastructure' },
  'isoflow__redis': { name: 'Redis', category: 'infrastructure' },
  'isoflow__backup': { name: 'Backup', category: 'infrastructure' },

  // Services
  'isoflow__api': { name: 'API', category: 'services' },
  'isoflow__microservice': { name: 'Microservice', category: 'services' },
  'isoflow__authentication': { name: 'Auth', category: 'services' },
  'isoflow__gateway': { name: 'Gateway', category: 'services' },

  // Network
  'isoflow__load_balancer': { name: 'Load Balancer', category: 'network' },
  'isoflow__cdn': { name: 'CDN', category: 'network' },
  'isoflow__queue': { name: 'Queue', category: 'network' },
  'isoflow__logs': { name: 'Logs', category: 'network' },

  // Users/Devices
  'isoflow__person': { name: 'Person', category: 'users' },
  'isoflow__mobile': { name: 'Mobile', category: 'users' },
  'isoflow__web_app': { name: 'Web App', category: 'users' },

  // Monitoring
  'isoflow__monitoring': { name: 'Monitoring', category: 'monitoring' },
  'isoflow__analytics': { name: 'Analytics', category: 'monitoring' },
  'isoflow__notification': { name: 'Notification', category: 'monitoring' },
  'isoflow__shield': { name: 'Shield', category: 'monitoring' }
};

// Default color palette
const DEFAULT_COLORS = [
  { id: 'blue', value: '#4A90D9' },
  { id: 'green', value: '#7CB342' },
  { id: 'orange', value: '#FF9800' },
  { id: 'red', value: '#E53935' },
  { id: 'purple', value: '#9C27B0' },
  { id: 'gray', value: '#78909C' },
  { id: 'teal', value: '#00ACC1' }
];

/**
 * Create a new diagram scaffold
 */
function createDiagram(title, description = '') {
  return {
    title,
    description,
    version: '1.0.0',
    fitToScreen: true,
    items: [],
    connectors: [],
    colors: [...DEFAULT_COLORS],
    icons: [],
    rectangles: [],
    textBoxes: []
  };
}

/**
 * Add an item to the diagram
 */
function addItem(diagram, { id, name, icon, x, y, description = '' }) {
  if (!ICONS[icon]) {
    console.warn(`Warning: Unknown icon "${icon}". Using isoflow__server as fallback.`);
    icon = 'isoflow__server';
  }

  diagram.items.push({
    id,
    name,
    description,
    icon,
    position: { x, y }
  });

  return diagram;
}

/**
 * Add a connector between items
 */
function addConnector(diagram, { id, from, to, color = 'blue', options = {} }) {
  const connector = {
    id,
    from,
    to,
    color,
    style: options.style || 'SOLID',
    showArrow: options.showArrow !== false,
    width: options.width || 2
  };

  if (options.labels) {
    connector.labels = options.labels;
  }

  diagram.connectors.push(connector);
  return diagram;
}

/**
 * Add a rectangle zone
 */
function addRectangle(diagram, { id, fromX, fromY, toX, toY, color = 'gray' }) {
  diagram.rectangles.push({
    id,
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    color
  });
  return diagram;
}

/**
 * Add a text annotation
 */
function addTextBox(diagram, { id, text, x, y }) {
  diagram.textBoxes.push({
    id,
    text,
    position: { x, y }
  });
  return diagram;
}

/**
 * Validate diagram structure
 */
function validateDiagram(diagram) {
  const errors = [];
  const itemIds = new Set(diagram.items.map(i => i.id));
  const colorIds = new Set(diagram.colors.map(c => c.id));

  // Check for duplicate item IDs
  if (itemIds.size !== diagram.items.length) {
    errors.push('Duplicate item IDs detected');
  }

  // Validate connectors
  for (const conn of diagram.connectors) {
    if (!itemIds.has(conn.from)) {
      errors.push(`Connector "${conn.id}" references unknown source item "${conn.from}"`);
    }
    if (!itemIds.has(conn.to)) {
      errors.push(`Connector "${conn.id}" references unknown target item "${conn.to}"`);
    }
    if (!colorIds.has(conn.color)) {
      errors.push(`Connector "${conn.id}" uses undefined color "${conn.color}"`);
    }
  }

  // Check for overlapping positions
  const positions = new Map();
  for (const item of diagram.items) {
    const key = `${item.position.x},${item.position.y}`;
    if (positions.has(key)) {
      errors.push(`Items "${positions.get(key)}" and "${item.id}" overlap at position (${item.position.x}, ${item.position.y})`);
    }
    positions.set(key, item.id);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Save diagram to file
 */
function saveDiagram(diagram, outputPath) {
  const validation = validateDiagram(diagram);
  if (!validation.valid) {
    console.error('Diagram validation failed:');
    validation.errors.forEach(e => console.error(`  - ${e}`));
    return false;
  }

  fs.writeFileSync(outputPath, JSON.stringify(diagram, null, 2));
  console.log(`Diagram saved to: ${outputPath}`);
  return true;
}

/**
 * Generate unique ID
 */
function generateId(prefix = 'item') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}

// Export for use as module
module.exports = {
  ICONS,
  DEFAULT_COLORS,
  createDiagram,
  addItem,
  addConnector,
  addRectangle,
  addTextBox,
  validateDiagram,
  saveDiagram,
  generateId
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--list-icons')) {
    console.log('\nAvailable Icons:\n');
    Object.entries(ICONS).forEach(([id, info]) => {
      console.log(`  ${id} - ${info.name} (${info.category})`);
    });
    process.exit(0);
  }

  if (args.includes('--template')) {
    const templateType = args[args.indexOf('--template') + 1] || 'basic';
    const outputPath = args[args.indexOf('--output') + 1] || './diagram.json';

    let diagram;

    switch (templateType) {
      case 'microservices':
        diagram = createDiagram('Microservices Architecture');
        addItem(diagram, { id: 'user', name: 'User', icon: 'isoflow__person', x: 0, y: 0 });
        addItem(diagram, { id: 'gateway', name: 'API Gateway', icon: 'isoflow__gateway', x: 2, y: 1 });
        addItem(diagram, { id: 'auth', name: 'Auth Service', icon: 'isoflow__authentication', x: 4, y: 0 });
        addItem(diagram, { id: 'api', name: 'API Service', icon: 'isoflow__api', x: 4, y: 2 });
        addItem(diagram, { id: 'db', name: 'Database', icon: 'isoflow__database', x: 6, y: 1 });
        addConnector(diagram, { id: 'c1', from: 'user', to: 'gateway', color: 'blue' });
        addConnector(diagram, { id: 'c2', from: 'gateway', to: 'auth', color: 'green' });
        addConnector(diagram, { id: 'c3', from: 'gateway', to: 'api', color: 'blue' });
        addConnector(diagram, { id: 'c4', from: 'api', to: 'db', color: 'orange' });
        break;

      case 'three-tier':
        diagram = createDiagram('Three-Tier Architecture');
        addItem(diagram, { id: 'web', name: 'Web App', icon: 'isoflow__web_app', x: 0, y: 0 });
        addItem(diagram, { id: 'lb', name: 'Load Balancer', icon: 'isoflow__load_balancer', x: 2, y: 1 });
        addItem(diagram, { id: 'app1', name: 'App Server 1', icon: 'isoflow__server', x: 4, y: 0 });
        addItem(diagram, { id: 'app2', name: 'App Server 2', icon: 'isoflow__server', x: 4, y: 2 });
        addItem(diagram, { id: 'db', name: 'Database', icon: 'isoflow__database', x: 6, y: 1 });
        addConnector(diagram, { id: 'c1', from: 'web', to: 'lb', color: 'blue' });
        addConnector(diagram, { id: 'c2', from: 'lb', to: 'app1', color: 'green' });
        addConnector(diagram, { id: 'c3', from: 'lb', to: 'app2', color: 'green' });
        addConnector(diagram, { id: 'c4', from: 'app1', to: 'db', color: 'orange' });
        addConnector(diagram, { id: 'c5', from: 'app2', to: 'db', color: 'orange' });
        break;

      default:
        diagram = createDiagram('New Diagram');
        addItem(diagram, { id: 'node1', name: 'Node 1', icon: 'isoflow__server', x: 0, y: 0 });
        addItem(diagram, { id: 'node2', name: 'Node 2', icon: 'isoflow__database', x: 2, y: 1 });
        addConnector(diagram, { id: 'c1', from: 'node1', to: 'node2', color: 'blue' });
    }

    saveDiagram(diagram, outputPath);
    process.exit(0);
  }

  console.log(`
FossFLOW Diagram Generator

Usage:
  node generate-diagram.js --list-icons          List available icons
  node generate-diagram.js --template <type>     Generate from template
                           --output <path>       Output file path

Templates: basic, microservices, three-tier

Example:
  node generate-diagram.js --template microservices --output my-diagram.json
`);
}
