/**
 * Unified Memory Layer
 * Combines SONA (Self-Optimizing Neural Architecture) and ReasoningBank
 * for cross-system pattern learning and retrieval
 */

import type {
  ConfidenceTier,
  MemoryQuery,
  MemorySearchResult,
  Pattern,
  PatternId,
  PatternType,
  SONAMode,
} from '../core/types.js';
import type { IMemory, MemoryStats } from '../core/interfaces.js';
import { createPatternId } from '../core/types.js';
import { HNSWIndex } from './hnsw-index.js';

// ============================================================================
// Configuration
// ============================================================================

export interface UnifiedMemoryConfig {
  sonaMode: SONAMode;
  dimensions: number;
  maxPatterns: number;
  confidenceThresholds: Record<ConfidenceTier, number>;
  dreamCycleInterval: number; // ms
  consolidationBatchSize: number;
}

const DEFAULT_CONFIG: UnifiedMemoryConfig = {
  sonaMode: 'balanced',
  dimensions: 384,
  maxPatterns: 100000,
  confidenceThresholds: {
    bronze: 0.7,
    silver: 0.8,
    gold: 0.9,
    platinum: 0.95,
  },
  dreamCycleInterval: 30000, // 30 seconds
  consolidationBatchSize: 100,
};

// SONA Mode configurations
const SONA_MODE_CONFIGS: Record<SONAMode, { latency: number; quality: number; memory: number }> = {
  'real-time': { latency: 0.5, quality: 0.7, memory: 25 },
  balanced: { latency: 18, quality: 0.75, memory: 50 },
  research: { latency: 100, quality: 0.95, memory: 100 },
  edge: { latency: 1, quality: 0.8, memory: 5 },
  batch: { latency: 50, quality: 0.85, memory: 75 },
};

// ============================================================================
// Unified Memory Implementation
// ============================================================================

export class UnifiedMemory implements IMemory {
  private readonly config: UnifiedMemoryConfig;
  private readonly patterns: Map<PatternId, Pattern> = new Map();
  private readonly vectorIndex: HNSWIndex;
  private readonly typeIndex: Map<PatternType, Set<PatternId>> = new Map();
  private dreamCycleTimer: ReturnType<typeof setInterval> | null = null;
  private searchLatencySum = 0;
  private searchCount = 0;

  constructor(config: Partial<UnifiedMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vectorIndex = new HNSWIndex({
      dimensions: this.config.dimensions,
      maxElements: this.config.maxPatterns,
    });
  }

  async initialize(): Promise<void> {
    // Start dream cycle timer if enabled
    if (this.config.dreamCycleInterval > 0) {
      this.dreamCycleTimer = setInterval(
        () => void this.runDreamCycle(),
        this.config.dreamCycleInterval
      );
    }
  }

  async shutdown(): Promise<void> {
    if (this.dreamCycleTimer) {
      clearInterval(this.dreamCycleTimer);
      this.dreamCycleTimer = null;
    }
  }

  // ============================================================================
  // Pattern Storage
  // ============================================================================

  async storePattern(
    pattern: Omit<Pattern, 'id' | 'createdAt' | 'lastUsedAt'>
  ): Promise<PatternId> {
    const id = createPatternId(`pat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
    const now = new Date();

    const fullPattern: Pattern = {
      ...pattern,
      id,
      createdAt: now,
      lastUsedAt: now,
      confidenceTier: this.calculateConfidenceTier(pattern.confidence),
    };

    // Store in patterns map
    this.patterns.set(id, fullPattern);

    // Index by vector
    if (pattern.embedding.length > 0) {
      this.vectorIndex.insert(id, pattern.embedding);
    }

    // Index by type
    let typeSet = this.typeIndex.get(pattern.type);
    if (!typeSet) {
      typeSet = new Set();
      this.typeIndex.set(pattern.type, typeSet);
    }
    typeSet.add(id);

    return id;
  }

  async getPattern(id: PatternId): Promise<Pattern | undefined> {
    const pattern = this.patterns.get(id);
    if (pattern) {
      // Update last used timestamp
      pattern.lastUsedAt = new Date();
    }
    return pattern;
  }

  async updatePattern(id: PatternId, updates: Partial<Pattern>): Promise<void> {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new Error(`Pattern not found: ${id}`);
    }

    // Apply updates
    Object.assign(pattern, updates);

    // Recalculate confidence tier if confidence changed
    if (updates.confidence !== undefined) {
      pattern.confidenceTier = this.calculateConfidenceTier(pattern.confidence);
    }

    // Re-index vector if embedding changed
    if (updates.embedding) {
      this.vectorIndex.delete(id);
      this.vectorIndex.insert(id, updates.embedding);
    }

    // Update type index if type changed
    if (updates.type) {
      // Remove from old type index
      for (const [type, set] of this.typeIndex) {
        if (set.has(id) && type !== updates.type) {
          set.delete(id);
        }
      }
      // Add to new type index
      let typeSet = this.typeIndex.get(updates.type);
      if (!typeSet) {
        typeSet = new Set();
        this.typeIndex.set(updates.type, typeSet);
      }
      typeSet.add(id);
    }
  }

  async deletePattern(id: PatternId): Promise<boolean> {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      return false;
    }

    // Remove from all indexes
    this.patterns.delete(id);
    this.vectorIndex.delete(id);

    const typeSet = this.typeIndex.get(pattern.type);
    if (typeSet) {
      typeSet.delete(id);
    }

    return true;
  }

  // ============================================================================
  // Search (HNSW-powered O(log n))
  // ============================================================================

  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    const startTime = performance.now();

    let results: MemorySearchResult[] = [];

    // Vector search if embedding provided
    if (query.embedding && query.embedding.length > 0) {
      const vectorResults = this.vectorIndex.search(query.embedding, query.limit ?? 10);

      results = vectorResults
        .map((vr) => {
          const pattern = this.patterns.get(vr.id as PatternId);
          if (!pattern) return null;
          return {
            pattern,
            similarity: vr.similarity,
            relevanceScore: this.calculateRelevance(pattern, query, vr.similarity),
          };
        })
        .filter((r): r is MemorySearchResult => r !== null);
    } else if (query.text) {
      // Semantic search via text (would use embedding model in production)
      results = await this.semanticSearch(query.text, query.limit ?? 10);
    } else {
      // Filter-based search
      results = this.filterPatterns(query);
    }

    // Apply type filter
    if (query.type) {
      results = results.filter((r) => r.pattern.type === query.type);
    }

    // Apply confidence filter
    if (query.minConfidence !== undefined) {
      results = results.filter((r) => r.pattern.confidence >= query.minConfidence!);
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    results = results.slice(0, query.limit ?? 10);

    // Track latency
    const latency = performance.now() - startTime;
    this.searchLatencySum += latency;
    this.searchCount++;

    return results;
  }

  async semanticSearch(text: string, limit = 10): Promise<MemorySearchResult[]> {
    // In production, this would use an embedding model
    // For now, we simulate with a simple text-based search
    const embedding = this.textToEmbedding(text);
    return this.search({ embedding, limit });
  }

  // ============================================================================
  // Learning Operations
  // ============================================================================

  async recordSuccess(patternId: PatternId): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.usageCount++;
    pattern.successRate =
      (pattern.successRate * (pattern.usageCount - 1) + 1) / pattern.usageCount;
    pattern.lastUsedAt = new Date();

    // Boost confidence based on success
    const confidenceBoost = 0.01 * (1 - pattern.confidence);
    pattern.confidence = Math.min(1, pattern.confidence + confidenceBoost);
    pattern.confidenceTier = this.calculateConfidenceTier(pattern.confidence);
  }

  async recordFailure(patternId: PatternId): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.usageCount++;
    pattern.successRate =
      (pattern.successRate * (pattern.usageCount - 1)) / pattern.usageCount;
    pattern.lastUsedAt = new Date();

    // Reduce confidence based on failure
    const confidencePenalty = 0.02 * pattern.confidence;
    pattern.confidence = Math.max(0, pattern.confidence - confidencePenalty);
    pattern.confidenceTier = this.calculateConfidenceTier(pattern.confidence);
  }

  async consolidatePatterns(): Promise<number> {
    // Dream Cycle: consolidate and optimize patterns
    let consolidated = 0;

    // Find similar patterns and merge low-confidence ones into high-confidence
    const patternList = Array.from(this.patterns.values());

    for (let i = 0; i < patternList.length; i++) {
      const pattern = patternList[i];
      if (!pattern || pattern.confidence >= this.config.confidenceThresholds.gold) {
        continue;
      }

      // Find similar high-confidence patterns
      const similar = await this.search({
        embedding: pattern.embedding,
        minConfidence: this.config.confidenceThresholds.gold,
        limit: 3,
      });

      if (similar.length > 0 && similar[0] && similar[0].similarity > 0.9) {
        // Merge into the similar pattern
        const target = similar[0].pattern;
        target.usageCount += pattern.usageCount;
        target.successRate =
          (target.successRate * (target.usageCount - pattern.usageCount) +
            pattern.successRate * pattern.usageCount) /
          target.usageCount;

        // Delete the low-confidence pattern
        await this.deletePattern(pattern.id);
        consolidated++;

        if (consolidated >= this.config.consolidationBatchSize) {
          break;
        }
      }
    }

    return consolidated;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): MemoryStats {
    const patternsByType: Record<string, number> = {};
    const patternsByTier: Record<string, number> = {};
    let confidenceSum = 0;

    for (const pattern of this.patterns.values()) {
      // Count by type
      patternsByType[pattern.type] = (patternsByType[pattern.type] ?? 0) + 1;

      // Count by tier
      patternsByTier[pattern.confidenceTier] =
        (patternsByTier[pattern.confidenceTier] ?? 0) + 1;

      confidenceSum += pattern.confidence;
    }

    return {
      totalPatterns: this.patterns.size,
      patternsByType,
      patternsByTier,
      averageConfidence: this.patterns.size > 0 ? confidenceSum / this.patterns.size : 0,
      searchLatency: this.searchCount > 0 ? this.searchLatencySum / this.searchCount : 0,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private calculateConfidenceTier(confidence: number): ConfidenceTier {
    if (confidence >= this.config.confidenceThresholds.platinum) return 'platinum';
    if (confidence >= this.config.confidenceThresholds.gold) return 'gold';
    if (confidence >= this.config.confidenceThresholds.silver) return 'silver';
    return 'bronze';
  }

  private calculateRelevance(
    pattern: Pattern,
    _query: MemoryQuery,
    similarity: number
  ): number {
    // Combine similarity with pattern quality metrics
    const qualityScore =
      pattern.confidence * 0.3 +
      pattern.successRate * 0.3 +
      Math.min(pattern.usageCount / 100, 1) * 0.2 +
      similarity * 0.2;

    return qualityScore;
  }

  private filterPatterns(query: MemoryQuery): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];

    for (const pattern of this.patterns.values()) {
      if (query.type && pattern.type !== query.type) continue;
      if (query.minConfidence && pattern.confidence < query.minConfidence) continue;

      results.push({
        pattern,
        similarity: 1,
        relevanceScore: pattern.confidence * pattern.successRate,
      });
    }

    return results;
  }

  private textToEmbedding(text: string): number[] {
    // Simple hash-based embedding for demonstration
    // In production, use a proper embedding model
    const embedding = new Array(this.config.dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const idx = (charCode * (i + 1)) % this.config.dimensions;
        embedding[idx] = (embedding[idx] + charCode / 255) % 1;
      }
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = embedding[i]! / magnitude;
      }
    }

    return embedding;
  }

  private async runDreamCycle(): Promise<void> {
    const modeConfig = SONA_MODE_CONFIGS[this.config.sonaMode];

    // Only run if in appropriate mode
    if (modeConfig.latency > 50) {
      await this.consolidatePatterns();
    }
  }

  // ============================================================================
  // SONA Mode Management
  // ============================================================================

  getSonaMode(): SONAMode {
    return this.config.sonaMode;
  }

  setSonaMode(mode: SONAMode): void {
    this.config.sonaMode = mode;
  }

  getSonaModeConfig(): { latency: number; quality: number; memory: number } {
    return SONA_MODE_CONFIGS[this.config.sonaMode];
  }
}
