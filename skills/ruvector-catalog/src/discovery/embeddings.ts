// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector
//
// Sparse TF-IDF embedder for V3. Replaces V2's dense feature-hashed
// approach with full-vocabulary sparse vectors. No dimension loss from
// hashing collisions. Cosine similarity computed directly on sparse vecs.

export interface SparseVector {
  indices: number[];
  values: number[];
  norm: number;
}

export interface SparseEmbedderConfig {
  minTermFreq: number;
  sublinearTf: boolean;
}

export class SparseTfIdfEmbedder {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private readonly config: SparseEmbedderConfig;
  private built = false;

  constructor(config?: Partial<SparseEmbedderConfig>) {
    this.config = {
      minTermFreq: config?.minTermFreq ?? 1,
      sublinearTf: config?.sublinearTf ?? true,
    };
  }

  get isBuilt(): boolean {
    return this.built;
  }

  get vocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Build vocabulary and IDF from a corpus of weighted documents.
   * Weight is used externally for field boosting — IDF is computed
   * purely from document frequency.
   */
  fit(documents: { id: string; text: string; weight: number }[]): void {
    const docFreq = new Map<string, number>();
    const termFreq = new Map<string, number>();

    for (const doc of documents) {
      const terms = this.tokenize(doc.text);
      const seen = new Set<string>();

      for (const term of terms) {
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
        if (!seen.has(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }
    }

    let idx = 0;
    for (const [term, freq] of termFreq) {
      if (freq >= this.config.minTermFreq) {
        this.vocabulary.set(term, idx++);
      }
    }

    const N = documents.length;
    for (const [term, df] of docFreq) {
      if (this.vocabulary.has(term)) {
        this.idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
      }
    }

    this.built = true;
  }

  /**
   * Embed a text string into a sparse TF-IDF vector.
   * Returns indices (vocabulary positions), values (TF-IDF weights),
   * and precomputed L2 norm.
   */
  embed(text: string): SparseVector {
    const terms = this.tokenize(text);
    if (terms.length === 0) {
      return { indices: [], values: [], norm: 0 };
    }

    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }

    const indices: number[] = [];
    const values: number[] = [];

    for (const [term, count] of tf) {
      const vocIdx = this.vocabulary.get(term);
      if (vocIdx === undefined) continue;

      const idfScore = this.idf.get(term) ?? 1.0;
      const tfScore = this.config.sublinearTf ? 1 + Math.log(count) : count;
      const tfidf = tfScore * idfScore;

      indices.push(vocIdx);
      values.push(tfidf);
    }

    // Sort by index for efficient similarity computation
    const pairs = indices.map((idx, i) => ({ idx, val: values[i] }));
    pairs.sort((a, b) => a.idx - b.idx);

    const sortedIndices: number[] = [];
    const sortedValues: number[] = [];
    let normSq = 0;

    for (const p of pairs) {
      sortedIndices.push(p.idx);
      sortedValues.push(p.val);
      normSq += p.val * p.val;
    }

    return {
      indices: sortedIndices,
      values: sortedValues,
      norm: Math.sqrt(normSq),
    };
  }

  /**
   * Cosine similarity between two sparse vectors.
   * Both vectors must have sorted indices (guaranteed by embed()).
   */
  similarity(a: SparseVector, b: SparseVector): number {
    if (a.norm === 0 || b.norm === 0) return 0;

    let dot = 0;
    let ai = 0;
    let bi = 0;

    while (ai < a.indices.length && bi < b.indices.length) {
      if (a.indices[ai] === b.indices[bi]) {
        dot += a.values[ai] * b.values[bi];
        ai++;
        bi++;
      } else if (a.indices[ai] < b.indices[bi]) {
        ai++;
      } else {
        bi++;
      }
    }

    return dot / (a.norm * b.norm);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
      .flatMap((t, i, arr) =>
        i < arr.length - 1 ? [t, `${t}_${arr[i + 1]}`] : [t]
      );
  }

  // Serialization
  serialize(): EmbedderSnapshot {
    return {
      config: this.config,
      vocabulary: Object.fromEntries(this.vocabulary),
      idf: Object.fromEntries(this.idf),
    };
  }

  static deserialize(snapshot: EmbedderSnapshot): SparseTfIdfEmbedder {
    const embedder = new SparseTfIdfEmbedder(snapshot.config);
    embedder.vocabulary = new Map(Object.entries(snapshot.vocabulary));
    const idfEntries: [string, number][] = Object.entries(snapshot.idf).map(
      ([k, v]) => [k, v as number]
    );
    embedder.idf = new Map(idfEntries);
    embedder.built = true;
    return embedder;
  }
}

export interface EmbedderSnapshot {
  config: SparseEmbedderConfig;
  vocabulary: Record<string, number>;
  idf: Record<string, number>;
}
