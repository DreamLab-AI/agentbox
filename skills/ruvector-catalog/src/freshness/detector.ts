// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { StalenessResult, CatalogVersion } from '../types/index.js';
import { CatalogRepository } from '../catalog/repository.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export class FreshnessService {
  private repo: CatalogRepository;
  private projectRoot: string;

  constructor(repo: CatalogRepository, projectRoot?: string) {
    this.repo = repo;
    this.projectRoot = projectRoot ?? process.cwd();
  }

  checkStaleness(): StalenessResult {
    const version = this.repo.getVersion();
    const submodulePath = join(this.projectRoot, 'ruvector');

    if (!existsSync(submodulePath)) {
      return {
        isStale: true,
        catalogCommit: version.ruvectorCommit,
        submoduleCommit: '',
        daysBehind: null,
        message: 'RuVector submodule not found. Run update-submodule.sh to add it.',
      };
    }

    let submoduleCommit: string;
    try {
      submoduleCommit = execSync(`git -C "${submodulePath}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    } catch {
      return {
        isStale: true,
        catalogCommit: version.ruvectorCommit,
        submoduleCommit: '',
        daysBehind: null,
        message: 'Cannot read submodule HEAD. The submodule may not be initialized.',
      };
    }

    if (submoduleCommit === version.ruvectorCommit) {
      return {
        isStale: false,
        catalogCommit: version.ruvectorCommit,
        submoduleCommit,
        daysBehind: 0,
        message: 'Catalog is up to date.',
      };
    }

    let daysBehind: number | null = null;
    try {
      const dateStr = execSync(
        `git -C "${submodulePath}" log -1 --format=%ci ${version.ruvectorCommitShort}`,
        { encoding: 'utf-8' }
      ).trim();
      const catalogDate = new Date(dateStr);
      daysBehind = Math.floor((Date.now() - catalogDate.getTime()) / (1000 * 60 * 60 * 24));
    } catch {
      // Shallow clone may not have the old commit
    }

    return {
      isStale: true,
      catalogCommit: version.ruvectorCommit,
      submoduleCommit,
      daysBehind,
      message: `Catalog is stale. Indexed commit: ${version.ruvectorCommitShort}, submodule HEAD: ${submoduleCommit.slice(0, 8)}${daysBehind !== null ? ` (${daysBehind} days behind)` : ''}.`,
    };
  }

  getVersion(): CatalogVersion {
    return this.repo.getVersion();
  }

  needsRebuild(): boolean {
    return this.checkStaleness().isStale;
  }
}
