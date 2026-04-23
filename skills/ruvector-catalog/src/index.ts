// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

// Core types
export type {
  Status, DeploymentTarget, SearchMode, IntegrationDifficulty, SubmoduleStatus,
  IndustryVertical, AudienceLevel, QueryIntent,
  Algorithm, Technology, Capability, CatalogExample,
  Scope, CatalogVersion, TechnologyFilter,
  RankedMatch, SearchQuery, SearchResult,
  ProposalMatch, Phase, Dependency, Risk, Projection, Proposal,
  SubmoduleState, StalenessResult, RebuildResult,
  ProblemSection, VerticalMapping, VerticalCapability,
  ScopeCheck, IntentResult,
} from './types/index.js';

// Catalog
export { CatalogRepository } from './catalog/repository.js';
export { CatalogStore } from './catalog/store.js';
export type { CatalogStoreData } from './catalog/store.js';

// Discovery
export { DiscoveryService } from './discovery/search.js';
export { SparseTfIdfEmbedder } from './discovery/embeddings.js';
export type { SparseVector, EmbedderSnapshot } from './discovery/embeddings.js';
export { IntentClassifier } from './discovery/intent.js';

// Proposals
export { ProposalService } from './proposals/generator.js';

// Freshness
export { FreshnessService } from './freshness/detector.js';
export { CatalogUpdater } from './freshness/updater.js';

// Submodule
export { SubmoduleService } from './submodule/manager.js';

// CI
export { CatalogVerifier } from './ci/verifier.js';
export type { CompletenessResult, TechClaim, DocumentVerification } from './ci/verifier.js';
export { WorkflowGenerator } from './ci/workflows.js';
