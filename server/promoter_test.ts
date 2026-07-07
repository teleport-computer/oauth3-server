// Scope-ingredient promotion — the 4th self-improvement loop.
// These tests prove clustering -> proposal on a FIXTURE of gate audit events (the live audit
// corpus is currently thin: handler.ts only emits read-kinds "items"/"screenshot", and the
// otter "live"/"frame" endpoints aren't wired yet). The fixture stands in for that corpus,
// per oauth3-server#72's scope-down rule. Honesty about corpus size is asserted via
// `observations`, and the loop-closure signal (a cluster already captured by an existing
// ingredient) is asserted for the otter:live-follow worked example.

import { assert, assertEquals } from "jsr:@std/assert";
import { proposeIngredients } from "./promoter.ts";
import type { AuditEntry } from "./audit.ts";

// Helper: build a gate audit line the way handler.ts does.
function gate(
  plugin: string,
  readKind: string,
  decision: "allow" | "deny",
  by: string,
): AuditEntry {
  return { ts: 0, action: "gate", detail: { plugin, readKind, decision, by } };
}

Deno.test("promote: otterpilot live+frame cluster proposes otter:live-follow's reads", () => {
  // otterpilot only ever touches live + frame -> the otter:live-follow ingredient (seeded).
  const fixture: AuditEntry[] = [
    gate("otter", "live", "allow", "otterpilot"),
    gate("otter", "frame", "allow", "otterpilot"),
    gate("otter", "frame", "allow", "otterpilot"),
    gate("otter", "live", "allow", "otterpilot"),
    // the plugin exposes more (items/screenshot) but otterpilot never touches them
    gate("otter", "items", "allow", "some-other-app"),
    gate("otter", "screenshot", "allow", "some-other-app"),
  ];
  const proposals = proposeIngredients(fixture);
  const p = proposals.find((x) => x.app === "otterpilot")!;
  assert(p, "otterpilot has a proposal");
  assertEquals(p.plugin, "otter");
  assertEquals(p.observed_reads, ["frame", "live"]); // the money shot
  assertEquals(p.proposed_ingredient.reads, ["frame", "live"]);
  assertEquals(p.observations, 4); // corpus weight, honestly reported
  // the loop is already closed: this cluster is the existing otter:live-follow ingredient.
  assertEquals(p.exists, "otter:live-follow");
  // label is a plain-words closure naming what's allowed and excluding what isn't.
  assert(p.proposed_ingredient.label.includes("read-only"));
  // reads are sorted in the label (stable, review-friendly): frame + live.
  assert(p.proposed_ingredient.label.includes("frame + live"));
  assert(p.proposed_ingredient.label.includes("not items"), "label names what it excludes");
});

Deno.test("promote: a single-read cluster (timeline-peek -> twitter:feed)", () => {
  const fixture: AuditEntry[] = [
    gate("twitter", "feed", "allow", "timeline-peek"),
    gate("twitter", "feed", "allow", "timeline-peek"),
    // twitter exposes more, but timeline-peek only hits feed
    gate("twitter", "timeline", "allow", "a-different-app"),
  ];
  const proposals = proposeIngredients(fixture);
  const p = proposals.find((x) => x.app === "timeline-peek")!;
  assertEquals(p.plugin, "twitter");
  assertEquals(p.observed_reads, ["feed"]);
  assertEquals(p.proposed_ingredient.name, "twitter:feed");
  assertEquals(p.exists, undefined); // no existing ingredient matches — a genuinely new proposal
  assert(p.proposed_ingredient.label.includes("not timeline"), "excludes the unused read");
});

Deno.test("promote: denied reads shape the universe but are NOT observed", () => {
  // An app TRIED items and was denied (e.g. by an otter:live-follow cap), then read live.
  // Denials must not count as observed reads, but they DO count toward the read universe so
  // the label can name what the app was blocked from.
  const fixture: AuditEntry[] = [
    gate("otter", "items", "deny", "capped-app"),
    gate("otter", "live", "allow", "capped-app"),
  ];
  const proposals = proposeIngredients(fixture);
  const p = proposals.find((x) => x.app === "capped-app")!;
  assertEquals(p.observed_reads, ["live"]); // denied "items" is NOT observed
  assertEquals(p.read_universe, ["items", "live"]); // but it grounded the "not items" half
  assert(p.proposed_ingredient.label.includes("not items"));
});

Deno.test("promote: empty / non-gate corpus yields no proposals", () => {
  assertEquals(proposeIngredients([]), []);
  // read audits (not gate) are ignored — only the gate chokepoint is the promotion source.
  assertEquals(
    proposeIngredients([{ ts: 0, action: "read", detail: { plugin: "otter", by: "x" } }]),
    [],
  );
  // malformed gate lines (missing fields) are skipped, not fabricated.
  assertEquals(proposeIngredients([{ ts: 0, action: "gate", detail: { plugin: "otter" } }]), []);
});

Deno.test("promote: multiple apps on one plugin cluster independently", () => {
  const fixture: AuditEntry[] = [
    gate("otter", "live", "allow", "app-a"),
    gate("otter", "items", "allow", "app-b"),
    gate("otter", "screenshot", "allow", "app-c"),
  ];
  const proposals = proposeIngredients(fixture);
  assertEquals(proposals.length, 3);
  assertEquals(proposals.map((p) => p.app).sort(), ["app-a", "app-b", "app-c"]);
});
