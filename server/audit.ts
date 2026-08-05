// Append-only audit log — backs the "a room only you can open" trust claim.
// Records cookie syncs, connect requests, approvals, mints, revocations, and reads.
// Owner-readable via GET /api/audit. Bounded by a retention policy (issue #120) so a
// high-churn source (e.g. cookies.sync) cannot grow the trail without limit.

export interface AuditEntry { ts: number; action: string; detail?: Record<string, unknown>; }

// Retention policy (issue #120) — the single source of truth for "how long is an audit row
// kept?". Two independent bounds, both applied on every write so the store self-bounds
// without a cron, and again at boot so an over-policy store self-heals:
//   * AGE  — drop rows older than RETENTION_MAX_AGE_DAYS. 90 days covers the incident-review
//            / forensics window for a personal server; older cookie-sync churn has no
//            investigative value and was what "implicitly retained forever" was doing wrong.
//   * COUNT — keep the RETENTION_MAX_ENTRIES most-recent rows. This is the bound that
//             actually stops a runaway source (the cookies.sync rate-limit issue) from
//             re-bloating the store, regardless of age.
// Tunable here on purpose: the operator sets the trust/retention trade-off in one place.
export const RETENTION_MAX_AGE_DAYS = 90;
export const RETENTION_MAX_ENTRIES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let file = "";
let log: AuditEntry[] = [];
let lastBootPrune: { before: number; after: number; removed: number } | null = null;

export async function initAudit(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/audit.json`;
  log = []; // reset; a missing store file means an empty trail, not stale in-memory state
  try { log = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  // Self-heal at boot: bring an over-policy store (one that outlived a tighter policy, or
  // grew before retention existed) back within bounds immediately. Captured so the owner
  // prune endpoint can show the reduction that happened at start-up on real data (#120).
  const before = log.length;
  const removed = applyRetention();
  if (file && removed > 0) await Deno.writeTextFile(file, JSON.stringify(log));
  lastBootPrune = { before, after: log.length, removed };
}

/** Apply the retention policy to the in-memory log in place; return the number removed. */
export function applyRetention(): number {
  const before = log.length;
  const cutoff = Date.now() - RETENTION_MAX_AGE_DAYS * DAY_MS;
  let kept = log.filter((e) => typeof e.ts === "number" && e.ts >= cutoff);
  if (kept.length > RETENTION_MAX_ENTRIES) kept = kept.slice(kept.length - RETENTION_MAX_ENTRIES);
  log = kept;
  return before - log.length;
}

export async function audit(action: string, detail?: Record<string, unknown>): Promise<void> {
  log.push({ ts: Date.now(), action, detail });
  applyRetention(); // enforce policy on every write — store self-bounds, no cron needed
  if (file) await Deno.writeTextFile(file, JSON.stringify(log));
}

export function auditLog(): AuditEntry[] { return log.slice().reverse(); }

async function fileSize(p: string): Promise<number> {
  if (!p) return 0;
  try { return (await Deno.stat(p)).size; } catch { return 0; }
}

/**
 * Owner-only (issue #120 demo): apply the retention policy now and report the audit-store
 * size before vs. after, plus the reduction (if any) that happened at boot on the real
 * on-disk store. Idempotent — on a store already within policy it removes 0 and reports
 * equal before/after.
 */
export async function pruneAudit(): Promise<{
  before: { entries: number; bytes: number };
  after: { entries: number; bytes: number };
  removed: number;
  policy: { maxAgeDays: number; maxEntries: number };
  boot: { before: number; after: number; removed: number } | null;
}> {
  const beforeEntries = log.length;
  const beforeBytes = await fileSize(file);
  const removed = applyRetention();
  if (file && removed > 0) await Deno.writeTextFile(file, JSON.stringify(log));
  return {
    before: { entries: beforeEntries, bytes: beforeBytes },
    after: { entries: log.length, bytes: await fileSize(file) },
    removed,
    policy: { maxAgeDays: RETENTION_MAX_AGE_DAYS, maxEntries: RETENTION_MAX_ENTRIES },
    boot: lastBootPrune,
  };
}
