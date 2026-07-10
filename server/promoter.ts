// Scope-ingredient promotion — the 4th self-improvement loop (RFC 0001's reifier, retargeted
// at SCOPE instead of execution). It grows the enforced scope vocabulary from what apps
// actually DO: it reads the `gate` audit events that handler.ts emits per read
// ({plugin, readKind, decision, by}), clusters the read-kinds each app touches per plugin,
// and PROPOSES a named scope ingredient (an entry for server/scopes.ts) capturing exactly
// that set — the smallest credential dial that still admits everything the app was observed
// doing. The label is a generated plain-words closure ("read-only · X · not Y").
//
// Honesty: this module only PROPOSES; a human curates the final ingredient name + label when
// adding the entry to scopes.ts (see otter:live-follow, the worked example). If the audit
// corpus is thin, callers should pass a fixture — proposeIngredients reports corpus size via
// the `observations` count on each proposal so the operator can weigh it.

import type { AuditEntry } from "./audit.ts";
import { SCOPE_INGREDIENTS } from "./scopes.ts";

export interface ProposedIngredient {
  name: string;
  plugin: string;
  reads: string[];
  label: string;
}

export interface Proposal {
  app: string;
  plugin: string;
  observations: number; // how many gate-allow events underpin this cluster (corpus weight)
  observed_reads: string[]; // sorted union of read-kinds this app was allowed to read
  read_universe: string[]; // every read-kind seen for this plugin across allow+deny (grounds "not Y")
  proposed_ingredient: ProposedIngredient;
  exists?: string; // name of an existing ingredient with the same (plugin, reads) — loop already closed
}

// Cluster gate-allow events by (app, plugin); emit one proposal per cluster. Only ALLOWED
// reads count as "observed" (an app that's denied items did not touch it). DENY events are
// still counted into the per-plugin read universe so the label's "not Y" half is grounded in
// what the plugin actually exposes rather than guessed.
export function proposeIngredients(events: AuditEntry[]): Proposal[] {
  const universe = new Map<string, Set<string>>(); // plugin -> every read-kind seen
  const counts = new Map<string, number>(); // key -> gate-allow count
  const reads = new Map<string, Set<string>>(); // key -> allowed read-kinds
  const meta = new Map<string, { app: string; plugin: string }>();

  for (const e of events) {
    if (e.action !== "gate") continue;
    const d = (e.detail ?? {}) as Record<string, unknown>;
    const plugin = typeof d.plugin === "string" ? d.plugin : "";
    const readKind = typeof d.readKind === "string" ? d.readKind : "";
    const by = typeof d.by === "string" ? d.by : "";
    const decision = typeof d.decision === "string" ? d.decision : "";
    if (!plugin || !readKind || !by) continue; // malformed gate line — skip, don't fabricate

    if (!universe.has(plugin)) universe.set(plugin, new Set());
    universe.get(plugin)!.add(readKind);

    if (decision !== "allow") continue; // denied reads are not "observed"
    const key = `${by}\0${plugin}`;
    if (!reads.has(key)) {
      reads.set(key, new Set());
      meta.set(key, { app: by, plugin });
    }
    reads.get(key)!.add(readKind);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const proposals: Proposal[] = [];
  for (const [key, set] of reads) {
    const { app, plugin } = meta.get(key)!;
    const observed = [...set].sort();
    const u = [...(universe.get(plugin) ?? new Set<string>())].sort();
    const exists = existingIngredient(plugin, observed);
    proposals.push({
      app,
      plugin,
      observations: counts.get(key) ?? 0,
      observed_reads: observed,
      read_universe: u,
      proposed_ingredient: { name: suggestName(plugin, observed), plugin, reads: observed, label: describe(observed, u) },
      exists,
    });
  }
  // Stable order: by plugin then app, so diffs and review are predictable.
  return proposals.sort((a, b) =>
    a.plugin === b.plugin ? a.app.localeCompare(b.app) : a.plugin.localeCompare(b.plugin)
  );
}

// Does an existing scope ingredient already capture this (plugin, reads) cluster? Closes the
// loop: the promoter notices "otterpilot's live+frame is already otter:live-follow".
function existingIngredient(plugin: string, reads: string[]): string | undefined {
  const sig = [...reads].sort().join("\0");
  for (const [name, ing] of Object.entries(SCOPE_INGREDIENTS)) {
    if (ing.plugin === plugin && [...ing.reads].sort().join("\0") === sig) return name;
  }
  return undefined;
}

// Plain-words closure: "read-only · live + frame · not items, screenshot". When the cluster
// already equals the whole observed universe (nothing to exclude), say so honestly.
function describe(reads: string[], universe: string[]): string {
  const allow = reads.join(" + ");
  const denied = universe.filter((r) => !reads.includes(r));
  const block = denied.length ? `not ${denied.join(", ")}` : "nothing else observed";
  return `read-only · ${allow} · ${block}`;
}

// A short, readable, stable slug derived from the reads. A human curates the final name when
// promoting to scopes.ts (e.g. otter:live+frame -> otter:live-follow).
function suggestName(plugin: string, reads: string[]): string {
  return `${plugin}:${reads.join("+")}`;
}
