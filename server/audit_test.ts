// Retention policy tests for #120. These pin the property the issue is about: the audit
// store is bounded — aged rows age out (90d) and a runaway source is capped at the
// newest N (1000) — and the owner prune endpoint reports real before/after sizes on the
// on-disk store. Tested through the real file API (initAudit boot-prune + pruneAudit).

import { assertEquals } from "jsr:@std/assert";
import {
  applyRetention,
  audit,
  auditLog,
  initAudit,
  pruneAudit,
  RETENTION_MAX_AGE_DAYS,
  RETENTION_MAX_ENTRIES,
  type AuditEntry,
} from "./audit.ts";

const DAY = 24 * 60 * 60 * 1000;

async function fresh(entries: AuditEntry[]): Promise<string> {
  const dir = await Deno.makeTempDir();
  if (entries.length) await Deno.writeTextFile(`${dir}/audit.json`, JSON.stringify(entries));
  await initAudit(dir); // loads + boot-prunes (sets lastBootPrune)
  return dir;
}

Deno.test("retention: drops entries older than the age window at boot", async () => {
  const now = Date.now();
  const old = { ts: now - (RETENTION_MAX_AGE_DAYS + 10) * DAY, action: "cookies.sync", detail: { plugin: "google-calendar" } };
  const young = { ts: now, action: "cookies.sync", detail: { plugin: "google-calendar" } };
  const dir = await fresh([old, old, old, old, young, young, young, young, young, young]);
  assertEquals(auditLog().length, 6); // 4 aged rows gone, 6 young kept
  const p = await pruneAudit();
  assertEquals(p.boot!.removed, 4); // boot prune removed exactly the aged rows
  assertEquals(p.boot!.before, 10);
});

Deno.test("retention: caps to the newest N when a source runs away", async () => {
  const base = Date.now() - 5 * DAY;
  // 1500 ascending-ts rows — a high-churn cookies.sync burst, all within the age window
  const many: AuditEntry[] = Array.from({ length: 1500 }, (_, i) => ({ ts: base + i, action: "cookies.sync", detail: { plugin: "google-calendar" } }));
  const dir = await fresh(many);
  assertEquals(auditLog().length, RETENTION_MAX_ENTRIES); // capped at 1000
  // the cap keeps the NEWEST (auditLog is newest-first, so [0] is the highest ts)
  const kept = auditLog();
  assertEquals(kept[0].ts, base + 1499);
  assertEquals(kept[kept.length - 1].ts, base + 500); // oldest 500 dropped
  const p = await pruneAudit();
  assertEquals(p.boot!.removed, 500);
});

Deno.test("audit(): every write keeps the store within policy (no cron)", async () => {
  // start one below the count cap, all recent
  const near: AuditEntry[] = Array.from({ length: RETENTION_MAX_ENTRIES - 1 }, (_, i) => ({ ts: Date.now(), action: "smoke.update" }));
  const dir = await fresh(near);
  assertEquals(auditLog().length, RETENTION_MAX_ENTRIES - 1);
  for (let i = 0; i < 5; i++) await audit("cookies.sync", { plugin: "google-calendar" });
  assertEquals(auditLog().length, RETENTION_MAX_ENTRIES); // never exceeds the cap
});

Deno.test("pruneAudit: reports before/after bytes + is idempotent on a bounded store", async () => {
  const now = Date.now();
  const dir = await fresh(Array.from({ length: 50 }, (_, i) => ({ ts: now, action: "token.mint", detail: { i } })));
  const p = await pruneAudit();
  assertEquals(p.removed, 0); // already within policy at boot
  assertEquals(p.before.entries, 50);
  assertEquals(p.after.entries, 50);
  assertEquals(typeof p.before.bytes, "number");
  assertEquals(typeof p.after.bytes, "number");
  assertEquals(p.after.bytes <= p.before.bytes, true);
  assertEquals(p.policy.maxAgeDays, RETENTION_MAX_AGE_DAYS);
  assertEquals(p.policy.maxEntries, RETENTION_MAX_ENTRIES);
});

Deno.test("pruneAudit: persists the prune to disk (boot reduction is durable)", async () => {
  const now = Date.now();
  const dir = await fresh(Array.from({ length: 1500 }, (_, i) => ({ ts: now, action: "gate" })));
  await pruneAudit();
  const onDisk: AuditEntry[] = JSON.parse(await Deno.readTextFile(`${dir}/audit.json`));
  assertEquals(onDisk.length, RETENTION_MAX_ENTRIES); // file rewritten to the bounded set
});

Deno.test("applyRetention: on an empty store is a safe no-op", async () => {
  await fresh([]); // reset module state to an empty store
  assertEquals(applyRetention(), 0);
  assertEquals(auditLog().length, 0);
});
