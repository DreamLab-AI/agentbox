// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector
//
// V3 self-updating pipeline. Builds sparse TF-IDF index instead of
// dense HNSW. Includes problem sections and verticals in store.

import { CatalogStore } from '../catalog/store.js';
import type { CatalogStoreData } from '../catalog/store.js';
import { CatalogRepository } from '../catalog/repository.js';
import { SparseTfIdfEmbedder } from '../discovery/embeddings.js';
import type { RebuildResult, CatalogVersion, Capability, Technology, Algorithm, CatalogExample } from '../types/index.js';

export class CatalogUpdater {
  private store: CatalogStore;
  private catalogDir: string;

  constructor(catalogDir?: string) {
    this.catalogDir = catalogDir ?? process.cwd();
    this.store = new CatalogStore(this.catalogDir);
  }

  needsRebuild(): boolean {
    if (!this.store.exists) return true;
    if (!this.store.load()) return true;
    return false;
  }

  rebuild(): RebuildResult {
    const start = performance.now();

    let previousVersion: CatalogVersion | null = null;
    if (this.store.exists && this.store.load()) {
      previousVersion = this.store.getVersion();
    }

    const repo = new CatalogRepository();
    const capabilities = repo.listCapabilities();
    const technologies = repo.listTechnologies();
    const algorithms = repo.listAlgorithms();
    const examples = repo.listExamples();
    const problemSections = repo.getProblemSections();
    const verticals = repo.listVerticals();
    const outOfScope = repo.getOutOfScope();

    // Build text corpus for sparse TF-IDF
    const corpus: { id: string; text: string; weight: number }[] = [];
    for (const tech of technologies) {
      const cap = repo.getCapability(tech.capabilityId);
      corpus.push({
        id: tech.id,
        text: [
          tech.name, tech.crate, tech.useWhen ?? '', tech.features ?? '',
          tech.useCases.join(' '), tech.plainDescription ?? '',
          tech.problemDomains.join(' '), tech.verticals.join(' '),
          cap?.description ?? '', cap?.keywords.join(' ') ?? '',
          ...tech.algorithms.map(a => `${a.name} ${a.description}`),
          tech.deploymentTargets.join(' '), tech.status,
        ].join(' '),
        weight: 1,
      });
    }

    const embedder = new SparseTfIdfEmbedder({ sublinearTf: true });
    embedder.fit(corpus);

    // Compute diff
    const previousTechIds = previousVersion
      ? new Set(this.store.getTechnologies().map(t => t.id))
      : new Set<string>();
    const currentTechIds = new Set(technologies.map(t => t.id));

    const added = [...currentTechIds].filter(id => !previousTechIds.has(id));
    const removed = [...previousTechIds].filter(id => !currentTechIds.has(id));

    // Build records
    const capRecord: Record<string, Capability> = {};
    for (const cap of capabilities) capRecord[cap.id] = cap;
    const techRecord: Record<string, Technology> = {};
    for (const tech of technologies) techRecord[tech.id] = tech;
    const algoRecord: Record<string, Algorithm> = {};
    for (const algo of algorithms) algoRecord[algo.name] = algo;
    const exRecord: Record<string, CatalogExample> = {};
    for (const ex of examples) exRecord[ex.name] = ex;

    const newVersion = repo.getVersion();
    const durationMs = performance.now() - start;

    const storeData: CatalogStoreData = {
      version: newVersion,
      capabilities: capRecord,
      technologies: techRecord,
      algorithms: algoRecord,
      examples: exRecord,
      problemSections,
      verticals,
      outOfScope,
      embedder: embedder.serialize(),
      buildTimestamp: new Date().toISOString(),
      buildDurationMs: Math.round(durationMs),
    };

    this.store.save(storeData);

    return {
      success: true,
      previousVersion,
      newVersion,
      added,
      removed,
      changed: [],
      durationMs: Math.round(durationMs),
    };
  }
}
