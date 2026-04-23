import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";

const LAZY_DIR = ".lazy";

/** Walk up from cwd to find existing .lazy/ directory */
export function findLazyRoot(from: string): string | null {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, LAZY_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Ensure .lazy/ exists, return its path */
export function ensureLazyDir(root: string): string {
  const dir = join(root, LAZY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Get path inside .lazy/ */
export function lazyPath(root: string, ...parts: string[]): string {
  return join(root, LAZY_DIR, ...parts);
}

/** Read a file from .lazy/, return null if missing */
export function readLazyFile(root: string, ...parts: string[]): string | null {
  const p = lazyPath(root, ...parts);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

/** Write a file to .lazy/, creating dirs as needed */
export function writeLazyFile(root: string, content: string, ...parts: string[]): void {
  const p = lazyPath(root, ...parts);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content, "utf-8");
}

/** Read JSON from .lazy/, return default if missing */
export function readLazyJson<T>(root: string, fallback: T, ...parts: string[]): T {
  const raw = readLazyFile(root, ...parts);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Write JSON to .lazy/ */
export function writeLazyJson(root: string, data: unknown, ...parts: string[]): void {
  writeLazyFile(root, JSON.stringify(data, null, 2) + "\n", ...parts);
}

/** Append a line to a file in .lazy/, creating dirs as needed */
export function appendLazyFile(root: string, content: string, ...parts: string[]): void {
  const p = lazyPath(root, ...parts);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(p, content, "utf-8");
}
