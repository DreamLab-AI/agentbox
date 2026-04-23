// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type {
  Capability, Technology, Algorithm, CatalogExample, CatalogVersion,
  TechnologyFilter, ProblemSection, VerticalMapping, IndustryVertical,
} from '../types/index.js';
import { CAPABILITIES, PROBLEM_SECTIONS, OUT_OF_SCOPE, EXAMPLES, VERTICALS } from './data.js';
import { CATALOG_VERSION } from './data.js';

export class CatalogRepository {
  private capabilityMap: Map<string, Capability>;
  private technologyMap: Map<string, Technology>;
  private algorithmMap: Map<string, Algorithm>;
  private exampleMap: Map<string, CatalogExample>;
  private problemSections: ProblemSection[];
  private outOfScopeCategories: string[];
  private verticalMap: Map<IndustryVertical, VerticalMapping>;

  constructor() {
    this.capabilityMap = new Map();
    this.technologyMap = new Map();
    this.algorithmMap = new Map();
    this.exampleMap = new Map();
    this.problemSections = [];
    this.outOfScopeCategories = [];
    this.verticalMap = new Map();
    this.loadData();
  }

  private loadData(): void {
    for (const cap of CAPABILITIES) {
      this.capabilityMap.set(cap.id, cap);
      for (const tech of cap.technologies) {
        this.technologyMap.set(tech.id, tech);
        for (const algo of tech.algorithms) {
          this.algorithmMap.set(algo.name, algo);
        }
      }
    }
    for (const ex of EXAMPLES) {
      this.exampleMap.set(ex.name, ex);
    }
    this.problemSections = PROBLEM_SECTIONS;
    this.outOfScopeCategories = OUT_OF_SCOPE;
    for (const v of Object.values(VERTICALS)) {
      this.verticalMap.set(v.vertical, v);
    }
  }

  getCapability(id: string): Capability | null {
    return this.capabilityMap.get(id) ?? null;
  }

  getTechnology(id: string): Technology | null {
    return this.technologyMap.get(id) ?? null;
  }

  getAlgorithm(name: string): Algorithm | null {
    return this.algorithmMap.get(name) ?? null;
  }

  getExample(name: string): CatalogExample | null {
    return this.exampleMap.get(name) ?? null;
  }

  listCapabilities(): Capability[] {
    return [...this.capabilityMap.values()];
  }

  listTechnologies(filter?: TechnologyFilter): Technology[] {
    let techs = [...this.technologyMap.values()];

    if (filter?.status) {
      techs = techs.filter(t => t.status === filter.status);
    }
    if (filter?.deploymentTarget) {
      techs = techs.filter(t => t.deploymentTargets.includes(filter.deploymentTarget!));
    }
    if (filter?.capability) {
      techs = techs.filter(t => t.capabilityId === filter.capability);
    }
    if (filter?.crate) {
      techs = techs.filter(t => t.crate === filter.crate);
    }

    return techs;
  }

  listAlgorithms(): Algorithm[] {
    return [...this.algorithmMap.values()];
  }

  listExamples(): CatalogExample[] {
    return [...this.exampleMap.values()];
  }

  getProblemSections(): ProblemSection[] {
    return this.problemSections;
  }

  getOutOfScope(): string[] {
    return this.outOfScopeCategories;
  }

  getVertical(id: IndustryVertical): VerticalMapping | null {
    return this.verticalMap.get(id) ?? null;
  }

  listVerticals(): VerticalMapping[] {
    return [...this.verticalMap.values()];
  }

  getVersion(): CatalogVersion {
    return CATALOG_VERSION;
  }

  get technologyCount(): number {
    return this.technologyMap.size;
  }

  get capabilityCount(): number {
    return this.capabilityMap.size;
  }

  get algorithmCount(): number {
    return this.algorithmMap.size;
  }

  get exampleCount(): number {
    return this.exampleMap.size;
  }

  /** Alias for getProblemSections() used by tests */
  listProblemSections(): ProblemSection[] {
    return this.getProblemSections();
  }

  /** Alias for getOutOfScope() used by tests */
  getOutOfScopeList(): string[] {
    return this.getOutOfScope();
  }

  /** Alias: get a single problem section by id */
  getProblemSection(id: string): ProblemSection | null {
    return this.problemSections.find(s => s.id === id) ?? null;
  }
}
