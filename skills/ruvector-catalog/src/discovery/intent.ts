// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type {
  IntentResult, QueryIntent, AudienceLevel, ScopeCheck,
  ProblemSection, IndustryVertical,
} from '../types/index.js';
import { CatalogRepository } from '../catalog/repository.js';

const NON_TECHNICAL_SIGNALS = [
  'non-technical', 'nontechnical', 'plain english', 'for my boss',
  'explain to', 'leadership', 'business case',
  'simple terms', 'layman', 'eli5', 'in simple',
];

const EXECUTIVE_SIGNALS = [
  'executive summary', 'ceo', 'cfo', 'cto brief', 'board presentation',
];

const SEMI_TECHNICAL_SIGNALS = [
  'architect', 'overview', 'trade-off', 'tradeoff', 'compare',
  'when to use', 'which one', 'best practice', 'high level',
];

const VERTICAL_KEYWORDS: Record<IndustryVertical, string[]> = {
  healthcare: ['healthcare', 'medical', 'clinical', 'patient', 'hipaa', 'ehr', 'diagnosis', 'health'],
  finance: ['finance', 'financial', 'trading', 'portfolio', 'risk', 'banking', 'fintech', 'market', 'stock'],
  robotics: ['robotics', 'robot', 'autonomous', 'control', 'motor', 'sensor', 'slam', 'navigation', 'actuator'],
  'edge-iot': ['edge', 'iot', 'embedded', 'microcontroller', 'sensor', 'device', 'gateway', 'realtime'],
  genomics: ['genomics', 'genome', 'dna', 'rna', 'sequence', 'bioinformatics', 'gene', 'protein', 'variant'],
};

const META_SIGNALS = [
  'how many', 'list all', 'what crates', 'what technologies',
  'catalog version', 'scope', 'stats', 'count',
  'ruvector-catalog', 'ruvector catalog', 'technology recommender',
  'improve the catalog', 'improve the ruvector',
];

/**
 * Explicit out-of-scope keyword patterns. If a query matches any of these
 * multi-word patterns, it is immediately classified as out-of-scope.
 * These supplement the category-based checkScope for queries that don't
 * share vocabulary with the OUT_OF_SCOPE category descriptions.
 */
/**
 * Multi-word phrases that strongly signal out-of-scope queries.
 * Each entry is checked as a substring of the lowercased query.
 * A single strong-pattern match is enough for out-of-scope.
 */
const OUT_OF_SCOPE_STRONG_PATTERNS = [
  'best selling books', 'write a book', 'draft a book',
  'marketing copy', 'marketing email', 'generate marketing',
  'e-commerce website', 'ecommerce website',
  'build a website', 'responsive website',
  'blog post', 'social media post', 'copywriting',
];

/**
 * Single-word or short patterns. Need 2+ matches.
 */
const OUT_OF_SCOPE_WEAK_PATTERNS = [
  'draft', 'books', 'novel', 'screenplay', 'blog',
  'advertising', 'copywriting', 'marketing',
  'e-commerce', 'ecommerce', 'website', 'web app', 'landing page',
  'responsive', 'frontend framework',
  'social media', 'seo', 'branding',
];

export class IntentClassifier {
  private repo: CatalogRepository | null;

  constructor(repo?: CatalogRepository) {
    this.repo = repo ?? null;
  }

  /**
   * Classify the intent of a query. Checks in order:
   * 1. Meta-query (asking about the catalog itself)
   * 2. Out-of-scope (no overlap with any section)
   * 3. Industry-vertical (matches vertical keywords)
   * 4. Technology-lookup (mentions a crate name directly)
   * 5. Problem-solution (default when matching a section header)
   *
   * When called with a single argument (query), uses the repository
   * provided in the constructor to resolve sections, outOfScope, and crateNames.
   */
  classify(
    query: string,
    sections?: ProblemSection[],
    outOfScope?: string[],
    crateNames?: string[],
  ): IntentResult {
    if (sections === undefined && this.repo) {
      sections = this.repo.getProblemSections();
      outOfScope = this.repo.getOutOfScope();
      crateNames = this.repo.listTechnologies().map(t => t.crate);
    }
    sections = sections ?? [];
    outOfScope = outOfScope ?? [];
    crateNames = crateNames ?? [];
    const lower = query.toLowerCase();
    const tokens = this.tokenize(lower);
    const audienceLevel = this.detectAudience(lower);

    // Empty query
    if (tokens.length === 0) {
      return {
        intent: 'problem-solution',
        confidence: 0.3,
        matchedVertical: null,
        audienceLevel,
        expandedTerms: [],
      };
    }

    // Meta query -- expand with self-learning and search-related terms
    // since meta-queries about the catalog benefit from these capabilities
    if (META_SIGNALS.some(s => lower.includes(s))) {
      const metaExpansion = [
        'self-learning', 'adapt', 'improve', 'sona', 'reasoning',
        'vector', 'search', 'hnsw', 'similarity', 'index', 'embedding',
        'recommendation', 'catalog', 'skill',
      ];
      return {
        intent: 'meta-query',
        confidence: 0.9,
        matchedVertical: null,
        audienceLevel,
        expandedTerms: [...tokens, ...metaExpansion],
      };
    }

    // Check if query matches any problem section (strong in-scope signal)
    const matchedSection = this.findMatchingSection(lower, sections);

    // Check scope -- but only classify as out-of-scope if
    // the query does NOT also match a problem section
    const scopeResult = this.checkScope(lower, outOfScope, sections);
    if (scopeResult.verdict === 'out-of-scope' && !matchedSection) {
      return {
        intent: 'out-of-scope',
        confidence: scopeResult.confidence,
        matchedVertical: null,
        audienceLevel,
        expandedTerms: tokens,
      };
    }

    // Industry vertical (only if the query is in-scope)
    if (scopeResult.verdict !== 'out-of-scope') {
      const matchedVertical = this.detectVertical(lower);
      if (matchedVertical) {
        const expanded = this.expandQuery(lower, sections);
        // Also expand with vertical-specific keywords to help TF-IDF matching
        const verticalExpansion = this.getVerticalExpansionTerms(matchedVertical);
        return {
          intent: 'industry-vertical',
          confidence: 0.8,
          matchedVertical,
          audienceLevel,
          expandedTerms: [...tokens, ...expanded, ...verticalExpansion],
        };
      }
    }

    // Technology lookup (mentions a crate name or technology name directly)
    const mentionsCrate = crateNames.some(c => lower.includes(c));
    // Also check if query mentions specific technology names/IDs
    let mentionsTech = false;
    if (this.repo) {
      const techNames = this.repo.listTechnologies().map(t => t.name.toLowerCase());
      const techIds = this.repo.listTechnologies().map(t => t.id.toLowerCase());
      const capIds = this.repo.listCapabilities().map(c => c.id.replace(/_/g, ' '));
      mentionsTech = [...techNames, ...techIds, ...capIds].some(
        name => name.length >= 4 && lower.includes(name)
      );
    }
    if (mentionsCrate || mentionsTech) {
      const expanded = this.expandQuery(lower, sections);
      return {
        intent: 'technology-lookup',
        confidence: 0.9,
        matchedVertical: null,
        audienceLevel,
        expandedTerms: [...tokens, ...expanded],
      };
    }

    // Problem-solution: matches a section header or its synonyms
    if (matchedSection) {
      const expanded = this.expandQuery(lower, sections);
      return {
        intent: 'problem-solution',
        confidence: 0.85,
        matchedVertical: null,
        audienceLevel,
        expandedTerms: [...tokens, ...expanded],
      };
    }

    // Default: problem-solution with lower confidence
    const expanded = this.expandQuery(lower, sections);
    return {
      intent: 'problem-solution',
      confidence: 0.5,
      matchedVertical: null,
      audienceLevel,
      expandedTerms: [...new Set([...tokens, ...expanded])],
    };
  }

  detectAudience(query: string): AudienceLevel {
    const lower = query.toLowerCase();

    if (EXECUTIVE_SIGNALS.some(s => lower.includes(s))) {
      return 'executive';
    }
    if (NON_TECHNICAL_SIGNALS.some(s => lower.includes(s))) {
      return 'non-technical';
    }
    if (SEMI_TECHNICAL_SIGNALS.some(s => lower.includes(s))) {
      return 'semi-technical';
    }
    // If query includes code-like tokens, it's technical
    if (/[{}()\[\]<>]|fn |struct |impl |async |\.rs\b|crate::/i.test(query)) {
      return 'technical';
    }
    return 'technical';
  }

  checkScope(query: string, outOfScope: string[], sections?: ProblemSection[]): ScopeCheck {
    const lower = query.toLowerCase();
    const tokens = this.tokenize(lower);

    // Collect all in-scope vocabulary from problem sections
    const inScopeTokens = new Set<string>();
    if (sections) {
      for (const section of sections) {
        for (const t of this.tokenize(section.header.toLowerCase())) inScopeTokens.add(t);
        for (const syn of section.synonyms) {
          for (const t of this.tokenize(syn.toLowerCase())) inScopeTokens.add(t);
        }
      }
    }

    // Check strong out-of-scope patterns (single match is enough)
    const strongMatch = OUT_OF_SCOPE_STRONG_PATTERNS.find(p => lower.includes(p));
    if (strongMatch) {
      return {
        verdict: 'out-of-scope',
        confidence: 0.9,
        matchedSections: [],
        outOfScopeCategory: strongMatch,
        suggestions: ['This query appears to be outside RuVector\'s scope.'],
      };
    }

    // Check weak out-of-scope patterns (need 2+ matches)
    const weakMatches = OUT_OF_SCOPE_WEAK_PATTERNS.filter(p => lower.includes(p));
    const pureWeakMatches = weakMatches.filter(p => {
      const pTokens = this.tokenize(p);
      return !pTokens.every(pt => inScopeTokens.has(pt));
    });

    if (pureWeakMatches.length >= 2) {
      return {
        verdict: 'out-of-scope',
        confidence: Math.min(0.95, 0.6 + pureWeakMatches.length * 0.1),
        matchedSections: [],
        outOfScopeCategory: 'Matched out-of-scope patterns: ' + pureWeakMatches.join(', '),
        suggestions: ['This query appears to be outside RuVector\'s scope.'],
      };
    }

    // Check against out-of-scope category descriptions
    for (const category of outOfScope) {
      const catTokens = this.tokenize(category.toLowerCase());
      const overlap = tokens.filter(t =>
        catTokens.some(ct => ct === t || (ct.length > 3 && t.length > 3 && (ct.includes(t) || t.includes(ct))))
      );
      const pureOutOfScope = overlap.filter(t => !inScopeTokens.has(t));

      const threshold = tokens.length <= 3 ? 1 : 2;
      if (pureOutOfScope.length >= threshold) {
        return {
          verdict: 'out-of-scope',
          confidence: Math.min(0.95, 0.5 + pureOutOfScope.length * 0.15),
          matchedSections: [],
          outOfScopeCategory: category,
          suggestions: [`"${category}" is outside RuVector's scope.`],
        };
      }
    }

    return {
      verdict: 'in-scope',
      confidence: 0.7,
      matchedSections: [],
      outOfScopeCategory: null,
      suggestions: [],
    };
  }

  expandQuery(query: string, sections: ProblemSection[]): string[] {
    const lower = query.toLowerCase();
    const tokens = this.tokenize(lower).filter(t => t.length >= 3);
    const expanded: string[] = [];

    for (const section of sections) {
      const headerTokens = this.tokenize(section.header.toLowerCase()).filter(t => t.length >= 3);
      const synonymTokens = section.synonyms.flatMap(s =>
        this.tokenize(s.toLowerCase()).filter(t => t.length >= 3)
      );
      const allSectionTokens = [...headerTokens, ...synonymTokens];

      const overlap = tokens.filter(t =>
        allSectionTokens.some(st => st === t || (st.length > 3 && t.length > 3 && (st.includes(t) || t.includes(st))))
      );

      if (overlap.length > 0) {
        expanded.push(...section.synonyms.flatMap(s => this.tokenize(s.toLowerCase())));
      }
    }

    return [...new Set(expanded)];
  }

  private getVerticalExpansionTerms(vertical: IndustryVertical): string[] {
    // Expand query with technology-related terms for each vertical
    // These terms help TF-IDF matching against technology descriptions
    const expansions: Record<IndustryVertical, string[]> = {
      healthcare: ['patient', 'safety', 'monitoring', 'clinical', 'diagnostic', 'coherence', 'drift', 'verification', 'hallucination', 'graph', 'causal', 'anomaly'],
      finance: ['trading', 'risk', 'anomaly', 'signal', 'coherence', 'drift', 'market', 'portfolio'],
      robotics: ['perception', 'sensor', 'control', 'navigation', 'real-time', 'autonomous'],
      'edge-iot': ['embedded', 'microcontroller', 'wasm', 'tiny', 'inference', 'quantized'],
      genomics: ['sequence', 'variant', 'biomarker', 'vector', 'similarity', 'graph', 'topology'],
    };
    return expansions[vertical] ?? [];
  }

  private detectVertical(query: string): IndustryVertical | null {
    let bestVertical: IndustryVertical | null = null;
    let bestCount = 0;

    for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
      const count = keywords.filter(kw => query.includes(kw)).length;
      if (count > bestCount) {
        bestCount = count;
        bestVertical = vertical as IndustryVertical;
      }
    }

    return bestCount >= 1 ? bestVertical : null;
  }

  private findMatchingSection(query: string, sections: ProblemSection[]): ProblemSection | null {
    const tokens = this.tokenize(query).filter(t => t.length >= 3);

    for (const section of sections) {
      const headerTokens = this.tokenize(section.header.toLowerCase()).filter(t => t.length >= 3);
      const synonymTokens = section.synonyms.flatMap(s =>
        this.tokenize(s.toLowerCase()).filter(t => t.length >= 3)
      );
      const allTokens = [...headerTokens, ...synonymTokens];

      const overlap = tokens.filter(t =>
        allTokens.some(st => st === t || (st.length > 3 && t.length > 3 && (st.includes(t) || t.includes(st))))
      );

      if (overlap.length >= 2 || (overlap.length === 1 && tokens.length <= 2)) {
        return section;
      }
    }

    return null;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }
}
