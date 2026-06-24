// Append-only audit log — backs the "a room only you can open" trust claim.
// Records cookie syncs, connect requests, approvals, mints, revocations, and reads.
// Owner-readable via GET /api/audit.

export interface AuditEntry { ts: number; action: string; detail?: Record<string, unknown>; }

let file = "";
let log: AuditEntry[] = [];

export async function initAudit(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/audit.json`;
  try { log = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export async function audit(action: string, detail?: Record<string, unknown>): Promise<void> {
  log.push({ ts: Date.now(), action, detail });
  if (log.length > 5000) log = log.slice(-5000);
  if (file) await Deno.writeTextFile(file, JSON.stringify(log));
}

export function auditLog(): AuditEntry[] { return log.slice().reverse(); }
