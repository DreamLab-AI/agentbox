// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector
//
// V3 discovery engine. Replaces V2's dense HNSW with sparse TF-IDF
// and adds intent classification, query expansion, and reranking.
// Per ADR-007: full vocabulary, no feature hashing.

import type {
  SearchResult, SearchQuery, RankedMatch, TechnologyFilter,
  SearchMode, IntentResult,
} from '../types/index.js';
import { CatalogRepository } from '../catalog/repository.js';
import { SparseTfIdfEmbedder, type SparseVector } from './embeddings.js';
import { IntentClassifier } from './intent.js';

interface IndexedDocument {
  id: string;
  type: 'technology' | 'example';
  vector: SparseVector;
  technologyId: string;
  capabilityId: string;
  isPrimary: boolean;
  status: string;
  capabilityKeywords: string[];
}

const SCORE_THRESHOLD = 0.15;

/** Field weight multipliers for document text construction */
const FIELD_WEIGHTS = {
  useWhen: 3,
  useCases: 3,
  keywords: 2,
  plainDescription: 2,
  name: 1,
  crate: 0.5,
  status: 0,
} as const;

export class DiscoveryService {
  private repo: CatalogRepository;
  private embedder: SparseTfIdfEmbedder;
  private intentClassifier: IntentClassifier;
  private documents: IndexedDocument[] = [];
  private indexBuilt = false;

  constructor(repo: CatalogRepository) {
    this.repo = repo;
    this.embedder = new SparseTfIdfEmbedder({ sublinearTf: true });
    this.intentClassifier = new IntentClassifier();
  }

  get isIndexBuilt(): boolean {
    return this.indexBuilt;
  }

  /**
   * Build the sparse TF-IDF index over all technologies and examples.
   * Field weights determine how much each field contributes to the
   * document vector during search.
   */
  buildIndex(): void {
    const corpus: { id: string; text: string; weight: number }[] = [];

    for (const cap of this.repo.listCapabilities()) {
      for (const tech of cap.technologies) {
        const textParts: string[] = [];

        // Field-weighted text: repeat fields proportional to weight
        this.repeatField(textParts, tech.name, FIELD_WEIGHTS.name);
        this.repeatField(textParts, tech.crate, FIELD_WEIGHTS.crate);
        this.repeatField(textParts, tech.useWhen ?? '', FIELD_WEIGHTS.useWhen);
        this.repeatField(textParts, tech.useCases.join(' '), FIELD_WEIGHTS.useCases);
        this.repeatField(textParts, cap.keywords.join(' '), FIELD_WEIGHTS.keywords);
        this.repeatField(textParts, tech.plainDescription ?? '', FIELD_WEIGHTS.plainDescription);
        // Always include these at weight 1
        textParts.push(cap.description);
        textParts.push(tech.features ?? '');
        textParts.push(tech.problemDomains.join(' '));
        textParts.push(tech.verticals.join(' '));
        textParts.push(...tech.algorithms.map(a => `${a.name} ${a.description}`));
        textParts.push(tech.deploymentTargets.join(' '));

        const text = textParts.join(' ');
        corpus.push({ id: tech.id, text, weight: 1 });
      }
    }

    // Index examples alongside technologies
    for (const ex of this.repo.listExamples()) {
      const text = `${ex.name} ${ex.description} ${ex.technologiesUsed.join(' ')}`;
      corpus.push({ id: `example:${ex.name}`, text, weight: 0.8 });
    }

    this.embedder.fit(corpus);

    // Build document vectors
    this.documents = [];
    for (const cap of this.repo.listCapabilities()) {
      for (const tech of cap.technologies) {
        const doc = corpus.find(c => c.id === tech.id)!;
        this.documents.push({
          id: tech.id,
          type: 'technology',
          vector: this.embedder.embed(doc.text),
          technologyId: tech.id,
          capabilityId: cap.id,
          isPrimary: cap.primaryCrate === tech.crate,
          status: tech.status,
          capabilityKeywords: cap.keywords,
        });
      }
    }

    for (const ex of this.repo.listExamples()) {
      const exDoc = corpus.find(c => c.id === `example:${ex.name}`)!;
      const firstTechId = ex.technologiesUsed[0] ?? '';
      const firstTech = this.repo.getTechnology(firstTechId);
      this.documents.push({
        id: `example:${ex.name}`,
        type: 'example',
        vector: this.embedder.embed(exDoc.text),
        technologyId: firstTechId,
        capabilityId: firstTech?.capabilityId ?? '',
        isPrimary: false,
        status: 'production',
        capabilityKeywords: [],
      });
    }

    this.indexBuilt = true;
  }

  /**
   * Main search. Runs intent classification, sparse TF-IDF retrieval,
   * then reranking with capability and status bonuses.
   */
  search(query: string, limit = 5): SearchResult & { intent: IntentResult } {
    const start = performance.now();

    if (!this.indexBuilt) {
      this.buildIndex();
    }

    const crateNames = this.repo.listTechnologies().map(t => t.crate);
    const sections = this.repo.getProblemSections();
    const outOfScope = this.repo.getOutOfScope();

    const intent = this.intentClassifier.classify(query, sections, outOfScope, crateNames);

    // Out-of-scope: return empty with advisory
    if (intent.intent === 'out-of-scope') {
      return {
        query: { rawText: query, mode: 'keyword', limit, filters: null },
        matches: [],
        mode: 'keyword' as SearchMode,
        latencyMs: performance.now() - start,
        totalCandidates: this.repo.technologyCount,
        intent,
      };
    }

    // Build search text from expanded terms
    const searchText = intent.expandedTerms.length > 0
      ? `${query} ${intent.expandedTerms.join(' ')}`
      : query;

    const queryVec = this.embedder.embed(searchText);

    // Score all documents
    // Use a lower initial threshold for vertical queries to avoid filtering out
    // relevant vertical technologies before the vertical filter is applied.
    // The final 0.15 threshold is enforced after reranking bonuses.
    const isVerticalQuery = intent.intent === 'industry-vertical' && intent.matchedVertical;
    const initialThreshold = isVerticalQuery ? SCORE_THRESHOLD * 0.3 : SCORE_THRESHOLD;

    let scored: Array<{ doc: IndexedDocument; score: number }> = [];

    for (const doc of this.documents) {
      const sim = this.embedder.similarity(queryVec, doc.vector);
      if (sim >= initialThreshold) {
        scored.push({ doc, score: sim });
      }
    }

    // If vertical intent, include ALL technologies from the vertical
    // (even those with low TF-IDF scores) and filter to only vertical techs
    if (isVerticalQuery && intent.matchedVertical) {
      const vertical = this.repo.getVertical(intent.matchedVertical);
      if (vertical) {
        const verticalTechIds = new Set(
          vertical.capabilities.flatMap(vc => vc.technologyIds)
        );

        // Add vertical technologies that weren't scored (below threshold)
        const scoredIds = new Set(scored.map(s => s.doc.technologyId));
        for (const doc of this.documents) {
          if (doc.type === 'technology' && verticalTechIds.has(doc.technologyId) && !scoredIds.has(doc.technologyId)) {
            const sim = this.embedder.similarity(queryVec, doc.vector);
            scored.push({ doc, score: Math.max(sim, 0.01) }); // minimum score to stay in results
          }
        }

        // Filter to only vertical-relevant technologies
        const filtered = scored.filter(s =>
          s.doc.type === 'example' || verticalTechIds.has(s.doc.technologyId)
        );
        if (filtered.length > 0) {
          scored = filtered;
        }
      }
    }

    // Reranking bonuses
    const queryTokens = this.tokenize(query);
    for (const entry of scored) {
      if (entry.doc.isPrimary) entry.score += 0.1;
      if (entry.doc.status === 'production') entry.score += 0.05;
      const kwOverlap = entry.doc.capabilityKeywords.filter(kw =>
        queryTokens.some(qt => kw.includes(qt) || qt.includes(kw))
      );
      if (kwOverlap.length > 0) entry.score += 0.05;
    }

    // Apply final score threshold after reranking bonuses
    scored = scored.filter(entry => entry.score >= SCORE_THRESHOLD);

    scored.sort((a, b) => b.score - a.score);

    // Deduplicate: prefer technologies over examples for the same tech
    const seen = new Set<string>();
    const deduped: typeof scored = [];
    for (const entry of scored) {
      const key = entry.doc.technologyId || entry.doc.id;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(entry);
      }
    }

    // Build ranked matches
    const matches: RankedMatch[] = [];
    for (const entry of deduped.slice(0, limit)) {
      const tech = this.repo.getTechnology(entry.doc.technologyId);
      if (!tech) continue;
      const cap = this.repo.getCapability(tech.capabilityId);
      if (!cap) continue;
      matches.push({
        technologyId: tech.id,
        score: Math.round(entry.score * 100) / 100,
        technology: tech,
        capability: cap,
      });
    }

    return {
      query: { rawText: query, mode: 'keyword', limit, filters: null },
      matches,
      mode: 'keyword' as SearchMode,
      latencyMs: performance.now() - start,
      totalCandidates: this.repo.technologyCount,
      intent,
    };
  }

  filter(filter: TechnologyFilter): RankedMatch[] {
    const techs = this.repo.listTechnologies(filter);
    return techs.map(tech => {
      const cap = this.repo.getCapability(tech.capabilityId)!;
      return { technologyId: tech.id, score: 1.0, technology: tech, capability: cap };
    });
  }

  private repeatField(parts: string[], text: string, weight: number): void {
    if (!text || weight <= 0) return;
    const count = Math.max(1, Math.round(weight));
    for (let i = 0; i < count; i++) {
      parts.push(text);
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }
}

/** Alias for backward compatibility with tests */
export const SearchEngine = DiscoveryService;
