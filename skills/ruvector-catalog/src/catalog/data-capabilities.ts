// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { Capability } from '../types/index.js';
import { ENRICHED_CAPABILITIES } from './data-cap-enriched.js';
import { DEFAULT_CAPABILITIES } from './data-cap-defaults.js';

export const CAPABILITIES: Capability[] = [
  ...ENRICHED_CAPABILITIES,
  ...DEFAULT_CAPABILITIES,
];
