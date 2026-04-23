// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { CatalogVersion } from '../types/index.js';

export { CAPABILITIES } from './data-capabilities.js';
export { PROBLEM_SECTIONS, OUT_OF_SCOPE, EXAMPLES } from './data-sections.js';
export { VERTICALS } from './data-verticals.js';

export const CATALOG_VERSION: CatalogVersion = {
  inventoryVersion: '4.0.0',
  ruvectorVersion: 'v3.0.0',
  ruvectorCommit: '3bbc8170d2394c129fef27247f045314599df3e6',
  ruvectorCommitShort: '3bbc8170',
  ruvectorCommitDate: '2026-03-28T12:26:23+00:00',
  generatedAt: '2026-03-28',
  scope: {
    rustLines: 1586481,
    sourceFiles: 3691,
    crates: 114,
    adrs: 135,
    examples: 44,
    npmPackages: 56,
  },
};
