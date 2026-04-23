// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { SubmoduleState, SubmoduleStatus } from '../types/index.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const RUVECTOR_URL = 'https://github.com/ruvnet/ruvector.git';

export class SubmoduleService {
  private projectRoot: string;
  private submodulePath: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.submodulePath = join(this.projectRoot, 'ruvector');
  }

  detectState(): SubmoduleState {
    const base: Omit<SubmoduleState, 'status'> = {
      localCommit: null,
      remoteCommit: null,
      path: 'ruvector/',
      url: RUVECTOR_URL,
      isShallow: false,
      hasLocalChanges: false,
    };

    if (!existsSync(this.submodulePath)) {
      return { ...base, status: 'absent' as SubmoduleStatus };
    }

    const gitDir = join(this.submodulePath, '.git');
    if (!existsSync(gitDir)) {
      return { ...base, status: 'absent' as SubmoduleStatus };
    }

    let localCommit: string;
    try {
      localCommit = execSync(`git -C "${this.submodulePath}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    } catch {
      return { ...base, status: 'absent' as SubmoduleStatus };
    }

    let hasLocalChanges = false;
    try {
      const status = execSync(`git -C "${this.submodulePath}" status --porcelain`, { encoding: 'utf-8' }).trim();
      hasLocalChanges = status.length > 0;
    } catch {
      // ignore
    }

    let isShallow = false;
    try {
      isShallow = existsSync(join(this.submodulePath, '.git', 'shallow'));
    } catch {
      // ignore
    }

    if (hasLocalChanges) {
      return { ...base, status: 'dirty' as SubmoduleStatus, localCommit, isShallow, hasLocalChanges };
    }

    let remoteCommit: string | null = null;
    try {
      execSync(`git -C "${this.submodulePath}" fetch origin main --depth 1`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
      remoteCommit = execSync(`git -C "${this.submodulePath}" rev-parse origin/main`, { encoding: 'utf-8' }).trim();
    } catch {
      return { ...base, status: 'present' as SubmoduleStatus, localCommit, isShallow };
    }

    const status: SubmoduleStatus = localCommit === remoteCommit ? 'current' : 'stale';
    return { ...base, status, localCommit, remoteCommit, isShallow };
  }

  add(): { success: boolean; commit: string; message: string } {
    try {
      execSync(`git submodule add --depth 1 ${RUVECTOR_URL} ruvector`, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      execSync('git submodule update --init --depth 1 ruvector', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      const commit = execSync(`git -C "${this.submodulePath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim();
      return { success: true, commit, message: `RuVector submodule added at commit ${commit}` };
    } catch (err) {
      return { success: false, commit: '', message: `Failed to add submodule: ${err}` };
    }
  }

  update(): { success: boolean; previousCommit: string; newCommit: string; message: string } {
    let previousCommit: string;
    try {
      previousCommit = execSync(`git -C "${this.submodulePath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim();
    } catch {
      return { success: false, previousCommit: '', newCommit: '', message: 'Cannot read current submodule commit' };
    }

    try {
      execSync(`git -C "${this.submodulePath}" fetch origin main --depth 1`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000,
      });
      execSync(`git -C "${this.submodulePath}" checkout main 2>/dev/null || git -C "${this.submodulePath}" checkout -b main origin/main`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      execSync(`git -C "${this.submodulePath}" pull --ff-only origin main`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      return {
        success: false,
        previousCommit,
        newCommit: previousCommit,
        message: 'Fast-forward update failed. The submodule may have diverged from upstream.',
      };
    }

    const newCommit = execSync(`git -C "${this.submodulePath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim();

    if (newCommit === previousCommit) {
      return { success: true, previousCommit, newCommit, message: 'Already up to date.' };
    }

    return { success: true, previousCommit, newCommit, message: `Updated ${previousCommit} -> ${newCommit}` };
  }

  ensureCurrent(): { action: string; message: string } {
    const state = this.detectState();

    switch (state.status) {
      case 'absent': {
        const result = this.add();
        return { action: 'added', message: result.message };
      }
      case 'stale': {
        const result = this.update();
        return { action: 'updated', message: result.message };
      }
      case 'current':
        return { action: 'already_current', message: 'Submodule is up to date.' };
      case 'dirty':
        return { action: 'failed', message: 'Submodule has local changes. Commit or stash them first.' };
      default:
        return { action: 'present', message: `Submodule is present (${state.status}).` };
    }
  }
}
