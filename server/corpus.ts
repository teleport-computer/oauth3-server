// Decision corpus — the RFC 0000 day-one hook. One JSONL line per grant decision
// (approve/deny at the connect chokepoint). Kept separate from audit.json because it
// will later gain outcome annotations (RFC 0005 step-up feedback). Not user-facing.

export interface CorpusRecord {
  ts: number;
  subject: string;                    // approver whose jar the grant reads
  app?: string;                       // requester
  scope: string;                      // plugin / intent requested
  decision: "approved" | "denied";
  grant?: string;                     // minted token id (approve only)
}

let file = "";

export function initCorpus(dir: string): void { if (dir) file = `${dir}/corpus.jsonl`; }

export async function corpus(rec: CorpusRecord): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(rec) + "\n", { append: true });
}
