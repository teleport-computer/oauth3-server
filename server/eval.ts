// RFC 0007 §4.1: The eval corpus — append-only log for tuning the curator.
// Same pattern as audit.ts (capped buffer + Deno.writeTextFile).
// Records the tuple {app, plugin, statement, workflow, decision, friction, outcome}.

import type { EvalEntry, Friction } from "./types.ts";

let file = "";
let log: EvalEntry[] = [];

export async function initEval(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/eval.json`;
  try { log = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

/**
 * Log an eval entry. Called at:
 * - request time (decision + friction)
 * - approve/deny time (outcome)
 * - revocation time (outcome)
 * - runtime step-up rejection (outcome) — RFC 0005, future work
 */
export async function logEval(entry: EvalEntry): Promise<void> {
  log.push(entry);
  if (log.length > 5000) log = log.slice(-5000);
  if (file) await Deno.writeTextFile(file, JSON.stringify(log));
}

/**
 * Find an eval entry by requestId (the join key). Returns the latest entry
 * for this request if it exists (used to fill outcome when user decides).
 */
export function findEvalByRequest(requestId: string): EvalEntry | undefined {
  // requestId is not directly stored; we scan to find the latest entry
  // that matches the app (which is derived from requestId in practice).
  // In practice, the caller will reconstruct the key from app/plugin/scope.
  return log.find((e) => e.app === requestId);
}

/**
 * Update an entry's outcome and humanVerdict. Used when:
 * - user approves/denies (outcome filled)
 * - human backfills a verdict (false-endorse/false-refuse/correct)
 * - runtime step-up rejects (outcome = "stepup-rejected")
 */
export async function updateEvalOutcome(
  app: string,
  plugin: string,
  outcome: EvalEntry["outcome"],
  humanVerdict?: EvalEntry["humanVerdict"],
): Promise<void> {
  const idx = log.findIndex((e) => e.app === app && e.plugin === plugin && !e.outcome);
  if (idx >= 0) {
    log[idx].outcome = outcome;
    if (humanVerdict) log[idx].humanVerdict = humanVerdict;
    if (file) await Deno.writeTextFile(file, JSON.stringify(log));
  }
}

/**
 * Get all eval entries — for the tuning loop (RFC 0007 §4.2).
 */
export function evalLog(): EvalEntry[] {
  return log.slice().reverse();
}
