// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

// --- Core enums and union types ---

export type Status = 'production' | 'experimental' | 'research';
export type DeploymentTarget = 'native' | 'wasm' | 'nodejs' | 'edge' | 'embedded' | 'fpga' | 'postgresql';
export type SearchMode = 'semantic' | 'keyword' | 'hybrid';
export type IntegrationDifficulty = 'easy' | 'medium' | 'hard';
export type SubmoduleStatus = 'absent' | 'present' | 'stale' | 'current' | 'detached' | 'dirty';

// V3 new union types
export type IndustryVertical = 'healthcare' | 'finance' | 'robotics' | 'edge-iot' | 'genomics';
export type AudienceLevel = 'technical' | 'semi-technical' | 'non-technical' | 'executive';
export type QueryIntent = 'problem-solution' | 'technology-lookup' | 'industry-vertical' | 'out-of-scope' | 'meta-query';

// --- Core data types ---

export interface Algorithm {
  name: string;
  technologyId: string;
  crate: string;
  complexity: string | null;
  description: string;
}

export interface Technology {
  // V2 fields (preserved)
  id: string;
  name: string;
  crate: string;
  capabilityId: string;
  complexity: string | null;
  latency: string | null;
  status: Status;
  useWhen: string | null;
  features: string | null;
  deploymentTargets: DeploymentTarget[];
  sourcePath: string;
  algorithms: Algorithm[];

  // V3 extensions (ADR-008)
  useCases: string[];
  problemDomains: string[];
  verticals: string[];
  plainDescription: string | null;
  relatedExamples: string[];
  primaryFor: string[];
}

export interface Capability {
  // V2 fields (preserved)
  id: string;
  description: string;
  primaryCrate: string;
  status: Status;
  docPath: string;
  keywords: string[];
  technologies: Technology[];

  // V3 extensions (ADR-008)
  problemStatement: string;
  synonyms: string[];
  relatedCapabilities: string[];
}

export interface CatalogExample {
  name: string;
  path: string;
  description: string;
  technologiesUsed: string[];
}

export interface Scope {
  rustLines: number;
  sourceFiles: number;
  crates: number;
  adrs: number;
  examples: number;
  npmPackages: number;
}

export interface CatalogVersion {
  inventoryVersion: string;
  ruvectorVersion: string;
  ruvectorCommit: string;
  ruvectorCommitShort: string;
  ruvectorCommitDate: string;
  generatedAt: string;
  scope: Scope;
}

// --- Search types ---

export interface TechnologyFilter {
  status?: Status;
  deploymentTarget?: DeploymentTarget;
  capability?: string;
  crate?: string;
  maxLatency?: string;
}

export interface RankedMatch {
  technologyId: string;
  score: number;
  technology: Technology;
  capability: Capability;
}

export interface SearchQuery {
  rawText: string;
  mode: SearchMode;
  limit: number;
  filters: TechnologyFilter | null;
}

export interface SearchResult {
  query: SearchQuery;
  matches: RankedMatch[];
  mode: SearchMode;
  latencyMs: number;
  totalCandidates: number;
}

// --- Proposal types ---

export interface ProposalMatch {
  rank: number;
  technology: Technology;
  capability: Capability;
  score: number;
  whyItMatches: string;
  integrationDifficulty: IntegrationDifficulty;
}

export interface Phase {
  name: string;
  duration: string;
  steps: string[];
}

export interface Dependency {
  type: 'cargo' | 'npm';
  name: string;
  version: string | null;
}

export interface Risk {
  description: string;
  mitigation: string;
}

export interface Projection {
  metric: string;
  current: string | null;
  projected: string;
  source: string;
}

export interface ScopeAdvisory {
  verdict: 'in-scope' | 'out-of-scope' | 'partial-scope';
  message: string;
}

export interface VerticalContext {
  vertical: IndustryVertical;
  regulatoryContext: string[];
  referenceDocuments: string[];
}

export interface Proposal {
  id: string;
  title: string;
  date: string;
  projectName: string;
  catalogVersion: CatalogVersion;
  problemStatement: string;
  matches: ProposalMatch[];
  integrationPlan: { phase1: Phase; phase2: Phase; phase3: Phase };
  dependencies: Dependency[];
  codeExample: string;
  risks: Risk[];
  performanceProjections: Projection[];
  scopeAdvisory?: ScopeAdvisory;
  verticalContext?: VerticalContext;
}

// --- Submodule types ---

export interface SubmoduleState {
  status: SubmoduleStatus;
  localCommit: string | null;
  remoteCommit: string | null;
  path: string;
  url: string;
  isShallow: boolean;
  hasLocalChanges: boolean;
}

export interface StalenessResult {
  isStale: boolean;
  catalogCommit: string;
  submoduleCommit: string;
  daysBehind: number | null;
  message: string;
}

export interface RebuildResult {
  success: boolean;
  previousVersion: CatalogVersion | null;
  newVersion: CatalogVersion;
  added: string[];
  removed: string[];
  changed: string[];
  durationMs: number;
}

// --- V3 problem-solution types ---

export interface ProblemSection {
  id: string;
  header: string;
  synonyms: string[];
  technologies: string[];
  primaryCrate: string;
}

export interface VerticalMapping {
  vertical: IndustryVertical;
  capabilities: VerticalCapability[];
  regulatoryContext: string[];
  referenceDocuments: string[];
}

export interface VerticalCapability {
  label: string;
  technologyIds: string[];
  plainDescription: string;
  useCases: string[];
}

export interface ScopeCheck {
  verdict: 'in-scope' | 'out-of-scope' | 'partial-scope';
  confidence: number;
  matchedSections: string[];
  outOfScopeCategory: string | null;
  suggestions: string[];
}

export interface IntentResult {
  intent: QueryIntent;
  confidence: number;
  matchedVertical: IndustryVertical | null;
  audienceLevel: AudienceLevel;
  expandedTerms: string[];
}
