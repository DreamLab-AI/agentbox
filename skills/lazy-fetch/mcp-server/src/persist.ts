import { join } from "path";
import { ensureLazyDir, readLazyJson, writeLazyJson, readLazyFile, writeLazyFile } from "./store.js";

interface Memory {
  [key: string]: {
    value: string;
    stored: string;
    updated: string;
  };
}

export async function remember(root: string, key: string, value: string): Promise<void> {
  if (!key || !value) {
    console.error("Usage: lazy remember <key> <value>");
    return;
  }

  ensureLazyDir(root);
  const mem = readLazyJson<Memory>(root, {}, "memory.json");
  const now = new Date().toISOString();

  const isUpdate = key in mem;
  mem[key] = {
    value,
    stored: mem[key]?.stored ?? now,
    updated: now,
  };

  writeLazyJson(root, mem, "memory.json");
  console.log(`${isUpdate ? "Updated" : "Stored"}: ${key} → ${value}`);
}

export async function recall(root: string, key?: string): Promise<void> {
  const mem = readLazyJson<Memory>(root, {}, "memory.json");
  const keys = Object.keys(mem);

  if (keys.length === 0) {
    console.log("Nothing stored yet. Use 'lazy remember <key> <value>'.");
    return;
  }

  if (!key) {
    // Show all
    console.log("\nStored knowledge:");
    console.log("─".repeat(50));
    for (const [k, v] of Object.entries(mem)) {
      console.log(`  ${k}: ${v.value}`);
    }
    return;
  }

  // Fuzzy match
  const query = key.toLowerCase();
  const matches = keys.filter((k) => k.toLowerCase().includes(query));

  if (matches.length === 0) {
    console.log(`No match for "${key}". Stored keys: ${keys.join(", ")}`);
    return;
  }

  for (const k of matches) {
    console.log(`${k}: ${mem[k].value}`);
  }
}

export async function journal(root: string, entry?: string): Promise<void> {
  ensureLazyDir(root);

  if (entry) {
    // Append entry
    const now = new Date().toISOString().split("T")[0];
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
    const line = `\n## ${now} ${time}\n${entry}\n`;

    const existing = readLazyFile(root, "journal.md") ?? "# Lazy Fetch Journal\n";
    writeLazyFile(root, existing + line, "journal.md");
    console.log("Journal entry added.");
  } else {
    // Read journal
    const content = readLazyFile(root, "journal.md");
    if (!content) {
      console.log("Journal is empty. Use 'lazy journal <entry>' to add one.");
      return;
    }
    console.log(content);
  }
}

export async function snapshot(root: string, name?: string): Promise<void> {
  ensureLazyDir(root);

  const now = new Date();
  const label = name ?? now.toISOString().split("T")[0];

  // Avoid overwriting existing snapshots
  const snapPath = join("snapshots", `${label}.json`);
  let finalLabel = label;
  if (readLazyFile(root, snapPath) !== null) {
    const suffix = now.toISOString().replace(/[:.]/g, "-").slice(11, 19);
    finalLabel = `${label}-${suffix}`;
  }

  // Collect current state
  const plan = readLazyFile(root, "plan.md");
  const mem = readLazyJson<Memory>(root, {}, "memory.json");

  const snap = {
    name: finalLabel,
    timestamp: now.toISOString(),
    plan: plan ?? "(no plan)",
    memoryKeys: Object.keys(mem),
    memoryCount: Object.keys(mem).length,
  };

  writeLazyJson(root, snap, "snapshots", `${finalLabel}.json`);
  console.log(`Snapshot saved: ${finalLabel}`);
}
