// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector
//
// Persistent JSON store for V3. Follows the redb schema from ADR-001.
// Uses atomic writes and file-based persistence.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type {
  Capability, Technology, Algorithm, CatalogExample, CatalogVersion,
  ProblemSection, VerticalMapping,
} from '../types/index.js';
import type { EmbedderSnapshot } from '../discovery/embeddings.js';

export interface CatalogStoreData {
  version: CatalogVersion;
  capabilities: Record<string, Capability>;
  technologies: Record<string, Technology>;
  algorithms: Record<string, Algorithm>;
  examples: Record<string, CatalogExample>;
  problemSections: ProblemSection[];
  verticals: VerticalMapping[];
  outOfScope: string[];
  embedder: EmbedderSnapshot | null;
  buildTimestamp: string;
  buildDurationMs: number;
}

export class CatalogStore {
  private data: CatalogStoreData | null = null;
  private storePath: string;

  constructor(catalogDir?: string) {
    const dir = catalogDir ?? join(process.cwd(), 'ruvector-catalog-v3');
    this.storePath = join(dir, 'catalog.store.json');
  }

  get isLoaded(): boolean {
    return this.data !== null;
  }

  get exists(): boolean {
    return existsSync(this.storePath);
  }

  get path(): string {
    return this.storePath;
  }

  load(): boolean {
    if (!existsSync(this.storePath)) return false;
    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      this.data = JSON.parse(raw);
      return true;
    } catch {
      this.data = null;
      return false;
    }
  }

  save(data: CatalogStoreData): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = this.storePath + '.tmp';
    const json = JSON.stringify(data, null, 0);
    writeFileSync(tmpPath, json, 'utf-8');

    const fs = require('fs');
    fs.renameSync(tmpPath, this.storePath);

    this.data = data;
  }

  getData(): CatalogStoreData | null {
    return this.data;
  }

  getVersion(): CatalogVersion | null {
    return this.data?.version ?? null;
  }

  getEmbedderSnapshot(): EmbedderSnapshot | null {
    return this.data?.embedder ?? null;
  }

  getCapabilities(): Capability[] {
    if (!this.data) return [];
    return Object.values(this.data.capabilities);
  }

  getTechnology(id: string): Technology | null {
    return this.data?.technologies[id] ?? null;
  }

  getTechnologies(): Technology[] {
    if (!this.data) return [];
    return Object.values(this.data.technologies);
  }

  getAlgorithms(): Algorithm[] {
    if (!this.data) return [];
    return Object.values(this.data.algorithms);
  }

  getExamples(): CatalogExample[] {
    if (!this.data) return [];
    return Object.values(this.data.examples);
  }

  fileSizeBytes(): number {
    if (!existsSync(this.storePath)) return 0;
    const fs = require('fs');
    return fs.statSync(this.storePath).size;
  }
}
