// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { CatalogRepository } from '../catalog/repository.js';

export interface CompletenessResult {
  complete: boolean;
  catalogCrates: string[];
  repoCrates: string[];
  missingFromCatalog: string[];
  extraInCatalog: string[];
  catalogExamples: string[];
  repoExamples: string[];
  missingExamples: string[];
  score: number;
  report: string;
}

export class CatalogVerifier {
  private repo: CatalogRepository;
  private ruvectorPath: string;

  constructor(repo: CatalogRepository, ruvectorPath?: string) {
    this.repo = repo;
    this.ruvectorPath = ruvectorPath ?? join(process.cwd(), 'ruvector');
  }

  verifyCompleteness(): CompletenessResult {
    const catalogCrates = this.getCatalogCrates();
    const catalogExamples = this.getCatalogExamples();

    let repoCrates: string[] = [];
    let repoExamples: string[] = [];

    const cratesDir = join(this.ruvectorPath, 'crates');
    const examplesDir = join(this.ruvectorPath, 'examples');

    if (existsSync(cratesDir)) {
      repoCrates = readdirSync(cratesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
    }

    if (existsSync(examplesDir)) {
      repoExamples = readdirSync(examplesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
    }

    const catalogCrateSet = new Set(catalogCrates);
    const repoCrateSet = new Set(repoCrates);
    const catalogExampleSet = new Set(catalogExamples);

    const missingFromCatalog = repoCrates.filter(c => !catalogCrateSet.has(c));
    const extraInCatalog = catalogCrates.filter(c => !repoCrateSet.has(c));
    const missingExamples = repoExamples.filter(e => !catalogExampleSet.has(e));

    const totalItems = repoCrates.length + repoExamples.length;
    const documentedItems = totalItems - missingFromCatalog.length - missingExamples.length;
    const score = totalItems > 0 ? documentedItems / totalItems : 1.0;

    const complete = missingFromCatalog.length === 0 && missingExamples.length === 0;

    const report = this.buildReport({
      complete, catalogCrates, repoCrates, missingFromCatalog, extraInCatalog,
      catalogExamples, repoExamples, missingExamples, score,
    });

    return {
      complete, catalogCrates, repoCrates, missingFromCatalog, extraInCatalog,
      catalogExamples, repoExamples, missingExamples, score, report,
    };
  }

  verifyDocument(filePath: string): DocumentVerification {
    if (!existsSync(filePath)) {
      return { valid: false, filePath, claims: [], errors: ['File not found'], warnings: [] };
    }

    const content = readFileSync(filePath, 'utf-8');
    const claims: TechClaim[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const cratePattern = /`(ruvector-[\w-]+|rvlite|ruvllm|sona|prime-radiant|rvagent-[\w-]+|ruqu[\w-]*|thermorust|cognitum-[\w-]+|micro-hnsw[\w-]*|neural-trader[\w-]*|rvf[\w-]*)`/g;
    let match;
    while ((match = cratePattern.exec(content)) !== null) {
      const crateName = match[1];
      const tech = this.findTechByCrate(crateName);
      claims.push({
        crateName,
        found: tech !== null,
        technologyName: tech?.name ?? null,
        line: content.substring(0, match.index).split('\n').length,
      });
      if (!tech) {
        warnings.push(`Line ${claims[claims.length - 1].line}: Crate \`${crateName}\` not found in catalog`);
      }
    }

    const allAlgos = this.repo.listAlgorithms();
    const algoNames = new Set(allAlgos.map(a => a.name));
    for (const algo of algoNames) {
      if (content.includes(algo)) {
        const foundAlgo = this.repo.getAlgorithm(algo);
        if (foundAlgo) {
          claims.push({
            crateName: foundAlgo.crate,
            found: true,
            technologyName: algo,
            line: content.indexOf(algo),
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      filePath,
      claims,
      errors,
      warnings,
    };
  }

  private getCatalogCrates(): string[] {
    const crates = new Set<string>();
    for (const tech of this.repo.listTechnologies()) {
      crates.add(tech.crate);
    }
    return [...crates].sort();
  }

  private getCatalogExamples(): string[] {
    return this.repo.listExamples().map(e => e.name).sort();
  }

  private findTechByCrate(crateName: string) {
    return this.repo.listTechnologies().find(t => t.crate === crateName) ?? null;
  }

  private buildReport(data: Omit<CompletenessResult, 'report'>): string {
    const lines: string[] = [];
    lines.push(`# Catalog Completeness Report`);
    lines.push('');
    lines.push(`**Score**: ${(data.score * 100).toFixed(1)}%`);
    lines.push(`**Status**: ${data.complete ? 'COMPLETE' : 'INCOMPLETE'}`);
    lines.push('');
    lines.push(`## Crates`);
    lines.push(`- In catalog: ${data.catalogCrates.length}`);
    lines.push(`- In repo: ${data.repoCrates.length}`);
    if (data.missingFromCatalog.length > 0) {
      lines.push(`- **Missing from catalog** (${data.missingFromCatalog.length}):`);
      for (const c of data.missingFromCatalog) {
        lines.push(`  - \`${c}\``);
      }
    }
    if (data.extraInCatalog.length > 0) {
      lines.push(`- Extra in catalog (not in repo): ${data.extraInCatalog.join(', ')}`);
    }
    lines.push('');
    lines.push(`## Examples`);
    lines.push(`- In catalog: ${data.catalogExamples.length}`);
    lines.push(`- In repo: ${data.repoExamples.length}`);
    if (data.missingExamples.length > 0) {
      lines.push(`- **Missing from catalog** (${data.missingExamples.length}):`);
      for (const e of data.missingExamples) {
        lines.push(`  - \`${e}\``);
      }
    }
    return lines.join('\n');
  }
}

export interface TechClaim {
  crateName: string;
  found: boolean;
  technologyName: string | null;
  line: number;
}

export interface DocumentVerification {
  valid: boolean;
  filePath: string;
  claims: TechClaim[];
  errors: string[];
  warnings: string[];
}
