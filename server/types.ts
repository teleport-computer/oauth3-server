// RFC 0007: The agentic curator — capability statements and discharge records.

/**
 * A cookie jar — record of cookie name/value pairs for a plugin.
 * This is the foundational data type for vault and plugins.
 */
export type Jar = Record<string, string>;

/**
 * A capability statement is generative prose plus a structured shadow.
 * The prose is what the user approves; the structure is what the machine
 * checks closure against. (RFC 0007 §2.1)
 */
export interface CapabilityStatement {
  // The human sentence the user approves, verbatim
  text: string;

  // Structured shadow — each array is the COMPLETE declared set (closure is "this and nothing else")

  // Credential flows: "Otter cookie reaches only the transcript-export call"
  flows: { cred: string; reaches: string[] }[];

  // Data reads: what data is accessed and to what extent
  reads: { data: string; extent: "all" | "metadata" | "named" }[];

  // Actions: what kinds of operations are allowed
  actions: { kind: "read" | "write" | "post"; allowed: boolean }[];

  // Egress: where results leave; [] + closed = nowhere
  egress: { to: string }[];

  // Explicit does-nots — things the handler definitively does not do
  negatives: string[];

  // Code-level properties: "nothing leaves the TEE", etc.
  codeProperties: string[];

  // The load-bearing "and nothing else" — closure flags per dimension
  closure: {
    flowsClosed: boolean;
    readsClosed: boolean;
    egressClosed: boolean;
  };
}

/**
 * The discharge record — how a capability statement was backed and to what level.
 * This is what verifiabilityOf() reads to place a request on the v-axis. (RFC 0007 §3.1)
 */
export interface Discharge {
  // Which verification workflow produced this
  workflow: "llm-judge" | "dev-evidence" | "by-construction" | "info-flow";

  // Discharge level (RFC 0004 Part-3 ladder)
  level: 1 | 2 | 3 | 4;

  // td-0020 Facts hash this binds to (required for level ≥ 3)
  factsHash?: string;

  // td-0022 evaluator id + hash, when run as appraisal
  evaluator?: string;

  // The checked set — what was actually observed by the workflow
  observed: {
    egress: string[];
    reads: CapabilityStatement["reads"];
    flows: string[];
  };

  // When this discharge was issued
  at: number;
}

/**
 * A listed plugin in the catalog. This is what createConnect checks
 * to enforce "an app must be listed to be consumable." (RFC 0007 §5.2)
 */
export interface Listing {
  id: string;
  plugin: string;
  scope?: string; // named narrow attenuation (b1)
  statement: CapabilityStatement;
  discharge: Discharge;
  attestation?: string; // td-0020 bundle URL
  status: "pending" | "listed" | "steered" | "demoted";
  steerTo?: string; // when a broad ask was consolidated
}

/**
 * Eval-corpus entry — the tuning loop's raw material. (RFC 0007 §4.1)
 */
export interface EvalEntry {
  ts: number;
  app: string; // ConnectReq.app / listing id
  plugin: string;
  scope?: string;
  statement: string; // the text approved
  workflow: Discharge["workflow"];
  decision: "discharged" | "refused";
  friction: Friction;
  outcome?: "approved" | "denied" | "revoked" | "stepup-rejected";
  humanVerdict?: "false-endorse" | "false-refuse" | "correct";
}

/**
 * Friction levels — what route() returns. (RFC 0007 §1.2)
 */
export type Friction = "trivial" | "informed-tap" | "dev-mode" | "steer";

/**
 * Route result — the decision plus optional steer target. (RFC 0007 §1.2)
 */
export interface RouteResult {
  friction: Friction;
  steerTo?: string;
  reason: string;
}
