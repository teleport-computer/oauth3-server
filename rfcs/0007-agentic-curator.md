# RFC 0007: The agentic curator — design spec (attenuation × verifiability, made operational)

## Status / relationship

RFC 0003 named the primitive (one delegation, parameterized by attenuation × verifiability) and gave the layer-1 approver a four-step job. RFC 0004 gave it a vocabulary (capability statements) and a portfolio (cheap→premium discharge). RFC 0000 named the discipline (cheap default + allocator + day-one corpus). The static-listing MVP (issue #23) builds the dumb version: a hand-edited catalog the `connect` flow checks against.

This RFC is the **full agentic design on top of that MVP**. It does not re-spec the host attestation stack — it consumes td-0020 `verify()` Facts, td-0022 evaluator verdicts, td-0021 evidence artifacts. Everything here extends structures that already exist in the server: `ConnectReq` (`connect.ts`), `Token` (`tokens.ts`), `Plugin` (`plugins/types.ts`), and the `audit()` append-only log (`audit.ts`). No new auth model — the curator sits *in front of* the unchanged `createConnect → approveConnect → mint` handshake.

---

## 1. The delegation primitive as a function

### 1.1 What "breadth" and "verifiability" actually are in this codebase

Today the breadth axis is **implicit and coarse**. `POST /api/connect {plugin, subject?, app?}` (`handler.ts:398`) carries no scope; `approveConnect` calls `mint(r.plugin, approver, r.app)` (`connect.ts:46`) and the resulting `Token` (`tokens.ts:6`) grants *everything the plugin can do* — `listItems` + `fetchItem` over the whole jar (`handler.ts:451-470`), and separately `/api/:plugin/screenshot` drives the browser SPI with the live cookie (`handler.ts:428-448`). `app` is a free display string, never verified.

So the primitive must be made **explicit on both axes** before it can be routed. Two additions to the request, both optional so the MVP path still works:

```ts
// extends ConnectReq in connect.ts
interface ConnectReq {
  // ...existing: requestId, plugin, subject?, app?, status, token?, createdAt
  scope?: string;        // requested attenuation key (see breadth ladder); default = plugin-wide read
  attestation?: string;  // URL of the requester's td-0020 evidence bundle (the verifiability claim)
}
```

**Breadth ladder (X axis)** — concrete points, each maps to what `mint` is allowed to bind:

| b | name | what the token may do | maps to |
|---|---|---|---|
| b0 | login | identity only, zero data | RFC 0002; `mint` not called — session only |
| b1 | narrow reviewed scope | one named capability of a plugin (`otter.list` titles+timestamps, not transcript text) | a sub-capability, see §2.4 |
| b2 | plugin-wide read | `listItems` + `fetchItem` over the jar (today's default token) | current `Token{plugin}` |
| b3 | rendered / browser-carrying | `/screenshot` — the cookie rides a live browser | `browserScreenshot` SPI |
| b4 | raw / zero-attenuation | the jar itself handed out | not currently expressible; gated to dev-mode |

**Verifiability ladder (Y axis)** — the RFC 0004 Part-3 discharge ladder, sourced not asserted. The value comes from resolving `req.attestation` against the host:

| v | name | source |
|---|---|---|
| v0 | dev-mode / unverifiable | nothing resolves; `INSTANCE_MODE != "attested"` for the requester |
| v1 | self-described, analysis pending | a capability statement exists, no discharge yet |
| v2 | claim discharged | a Part-2 workflow backs the statement (§3) |
| v3 | attested | the discharged statement binds to td-0020 Facts at a `source.tree_hash` |
| v4 | curated "safe" | td-0022 verdict passes curator C's spec **and** holistic human sign-off |

### 1.2 The routing function

```ts
type Friction = "trivial" | "informed-tap" | "dev-mode" | "steer";

function route(req: ConnectReq): { friction: Friction; steerTo?: string; reason: string } {
  const b = breadthOf(req.scope, req.plugin);          // b0..b4
  const v = verifiabilityOf(req.attestation);          // v0..v4, resolved from td-0020 Facts
  const need = required[b];                             // monotonic threshold, table below
  if (v >= need + 1) return { friction: "trivial", reason: "verifiability exceeds breadth" };
  if (v >= need)     return { friction: "informed-tap", reason: "breadth priced, show the statement" };
  // under-verified for the breadth asked: never silently broaden.
  const paved = consolidatedPatternFor(req.plugin, req.scope); // §5.3
  if (paved) return { friction: "steer", steerTo: paved, reason: "a reviewed narrower scope exists" };
  return { friction: "dev-mode", reason: "broad + unverifiable; the human owns this grant" };
}
```

`required[b]` is the **price of breadth in verifiability** (RFC 0003's governing rule, made numeric):

| breadth | `required` verifiability |
|---|---|
| b0 login | v0 |
| b1 narrow reviewed | v1 |
| b2 plugin-wide | v2 |
| b3 rendered/browser | v3 |
| b4 raw credential | v4 (or explicit dev-mode) |

### 1.3 The matrix, concrete

Cells are the `Friction` the function returns. This is RFC 0003's 2×2 expanded to the real ladders:

| breadth ↓ \ verifiability → | v0 dev | v1 self-desc | v2 discharged | v3 attested | v4 curated |
|---|---|---|---|---|---|
| **b1 narrow** | informed-tap | trivial | trivial | trivial | trivial |
| **b2 plugin-wide** | steer→b1 / dev-mode | informed-tap | trivial | trivial | trivial |
| **b3 browser** | dev-mode | steer→b1/b2 | informed-tap | trivial | trivial |
| **b4 raw jar** | dev-mode | dev-mode | steer→b3 | informed-tap | trivial |

Reading it: the **diagonal and above is friction-free**; below the diagonal you are under-verified for what you asked, so you are either *steered* to a paved narrower scope (if one exists) or pushed to *dev-mode* (the explicit, audited, human-owns-it escape hatch). The bottom-left corner — broad **and** unverifiable — is exactly dev-mode, never silent. This is RFC 0003's "the easy path is the safe path and leaving it is explicit," made into a lookup.

### 1.4 Where it plugs in

`route()` runs inside `createConnect` (`connect.ts:32`), before the request is persisted. Its result rides on the `ConnectReq` and is rendered by `approvePage` (`handler.ts:424`):

- **trivial** → the approve page shows a one-tap "Allow" with the discharged statement collapsed; the owner clicks once. (Not auto-approved — RFC 0003 keeps the per-user grant; "trivial" is *friction*, not *authority*.)
- **informed-tap** → the page expands the capability statement + discharge level; the owner reads, then taps.
- **steer** → the page leads with the consolidated alternative ("you asked for the raw Otter cookie; the reviewed `otter.list` adapter is pre-approved — use that?") and offers it as the default action, the broad ask as a secondary.
- **dev-mode** → a distinct, frictionful affordance, owner-secret-gated (not just session), and `audit("connect.devmode", …)` is written so the grant is forever attributable.

`approveConnect` is unchanged — whatever the owner approves still mints exactly one scoped token bound to the approver's subject.

---

## 2. Capability statements (RFC 0004) made concrete

### 2.1 Schema

The statement is **generative prose plus a structured shadow** — the prose is what the user approves (RFC 0004: "anything can be explained in a precise language"), the structure is what the machine checks closure against. Stored on the `Plugin` and referenced by the listing:

```ts
interface CapabilityStatement {
  text: string;            // the human sentence the user approves, verbatim
  // structured shadow — each array is the COMPLETE declared set (closure is "this and nothing else")
  flows:   { cred: string; reaches: string[] }[];   // "Otter cookie reaches only the transcript-export call"
  reads:   { data: string; extent: "all" | "metadata" | "named" }[];
  actions: { kind: "read" | "write" | "post"; allowed: boolean }[];
  egress:  { to: string }[];                          // where results leave; [] + closed = nowhere
  negatives: string[];                                // explicit does-nots
  codeProperties: string[];                            // "nothing leaves the TEE" — tagged code-level, not data
  closure: {                                           // the load-bearing "and nothing else"
    flowsClosed: boolean;  readsClosed: boolean;  egressClosed: boolean;
  };
}
```

`closure: {…Closed: true}` is the assertion that the declared set is **exhaustive** — the contract, not the marketing. A statement with all-false closure is a brochure and discharges to nothing above v1.

### 2.2 How an LLM writes one

The curator agent (§5) is handed two inputs that already exist host-side: the app's **source at `Facts.source.tree_hash`** (td-0020) and, for an oauth3 plugin specifically, the plugin's own `listItems`/`fetchItem`/egress code. It produces the statement generatively — one precise sentence — and the structured shadow by reading what the handler actually touches. Prompt contract (the writing guide is RFC 0004's shape table, *not* an enum the model must fill):

1. Read the handler at the pinned hash; enumerate every credential use, every outbound host, every read extent.
2. Write the closure-bearing sentence ("Reads **all** your watch history, and **nothing else** leaves the TEE").
3. Emit the structured shadow as the exhaustive declared sets, setting `closure.*` true only for the dimensions the read of the code actually supports.
4. The model **may not** write a closure it cannot point to source lines for — that is the boundary between a statement and a discharged statement (§3).

### 2.3 How closure is checked

Closure is a **subset test between the declared set and the observed-possible set**, per dimension:

```
egressClosed holds  ⟺  observed_egress_hosts(code) ⊆ {e.to for e in statement.egress}
readsClosed  holds  ⟺  observed_reads(code)        ⊆ statement.reads
flowsClosed  holds  ⟺  every credential sink in code is named in statement.flows
```

`observed_*` comes from whichever Part-2 workflow discharges the statement (§3): the LLM-judge yields a *claimed* observed set (low assurance); info-flow analysis yields a *proven* one (the subset test becomes mechanical). The statement is **refused** — escalated, never weakened (RFC 0000 rule 5) — if the observed set exceeds the declared set; that is a false-closure, the single most important failure to catch and the headline entry in the eval corpus (§4).

### 2.4 The `Plugin` schema change

`Plugin` (`plugins/types.ts:14`) gains an optional capability block and, for narrow scopes (breadth b1), a map of sub-capabilities so a reviewed `otter.list` is a *first-class point on the attenuation axis*, not a special case:

```ts
interface Plugin {
  // ...existing: id, label, cookieDomains, renderUrl?, loggedIn, listItems, fetchItem
  capability?: CapabilityStatement;          // the plugin-wide (b2) statement
  scopes?: Record<string, {                   // named narrow attenuations (b1)
    statement: CapabilityStatement;
    read(jar: Jar): Promise<unknown>;         // the attenuated read, e.g. titles+timestamps only
  }>;
}
```

`req.scope` (§1.1) indexes `plugin.scopes`. When set, `mint` binds the token to `plugin#scope` and the read route (`handler.ts:451`) dispatches to `scopes[scope].read` instead of `listItems`/`fetchItem`. This is the concrete mechanism behind RFC 0003's "egress-lock as the default consolidated pattern" — a scope *is* a consolidated pattern, born narrow.

---

## 3. The verification portfolio — discharging cheap→premium

### 3.1 The discharge record

Each statement, once backed, carries a `Discharge` that names *how* it was backed and *to what level* — the value `verifiabilityOf()` (§1.2) reads:

```ts
interface Discharge {
  workflow: "llm-judge" | "dev-evidence" | "by-construction" | "info-flow";
  level: 1 | 2 | 3 | 4;          // the RFC 0004 Part-3 ladder
  factsHash?: string;            // td-0020 Facts hash this binds to (required for level ≥ 3)
  evaluator?: string;            // td-0022 evaluator id + hash, when run as appraisal
  observed: { egress: string[]; reads: CapabilityStatement["reads"]; flows: string[] }; // the checked set
  at: number;
}
```

### 3.2 Which workflow, when — the allocator

This is RFC 0000's opportunistic spend: cheap default always runs, premium only where worth pays. The allocator key is **usage · breadth · declines** (the same signals RFC 0000 names for the audit-spend loop):

| workflow | cost | runs… | produces level |
|---|---|---|---|
| **LLM-judge reads the code** | cheap, always | on every newly-listed app at admit time (§5) | 1–2 (claimed observed set) |
| **developer-supplied evidence** | dev pays upfront | when the dev ships td-0021 `evidence/` artifacts (repro stubs, invariant tests) | 2 (audit-ready, fewer judge hours) |
| **trust-by-construction** | cheap *if born here* | when the app was generated through our checker with a co-generated safety analysis | 2–3 (the cheapest strong tier) |
| **info-flow proven** | premium, last | only when the allocator fires: app is hot (read-count from `audit.ts`), broad (b3/b4), or has a decline/incident on record | 3–4 (mechanical observed set) |

td-0022's evaluator is the host-side engine for `dev-evidence` and parts of `info-flow`: it judges the app's Facts + source at `tree_hash` against a curator spec and emits per-clause verdicts with `{path, line, note}` evidence pointers. The oauth3 curator *is* a named td-0022 curator C; its spec clauses are the closure dimensions of §2.3 (e.g. `egress.closed`, `flows.cred_reaches_only`).

### 3.3 How discharge gates breadth

Direct: `level` *is* the `v` in §1.2's `verifiabilityOf`, and `required[b]` (§1.2) is the gate. So:

- an app discharged at **level 1** (LLM-judge, claimed) can reach **trivial** only for **b1 narrow** scopes; for **b2 plugin-wide** it is informed-tap, for **b3 browser** it is steered.
- to get a **raw-jar (b4)** grant friction-free you need **level 4** — curated, with info-flow or holistic human sign-off. Anything less and the matrix (§1.3) routes you to steer or dev-mode.

A **decline or incident** (recorded as `audit("connect.deny", …)` or a runtime step-up reject, RFC 0005) **demotes** the discharge — re-opens a "safe" rating, bumps the app up the portfolio for re-analysis (RFC 0004: "usage raises the bar"). No silent persistence of a stale level.

---

## 4. The eval corpus + tuning loop (RFC 0000, day one)

### 4.1 The collection hook — wired before the curator is load-bearing

A new append-only log, structurally identical to `audit.ts` (same `Deno.writeTextFile` persistence, same `init/append/read` shape, capped buffer), recording the RFC 0004 Part-4 tuple:

```ts
interface EvalEntry {
  ts: number;
  app: string;             // ConnectReq.app / listing id
  plugin: string; scope?: string;
  statement: string;       // the text approved
  workflow: Discharge["workflow"];
  decision: "discharged" | "refused";   // what the curator decided
  friction: Friction;                    // what route() returned
  outcome?: "approved" | "denied" | "revoked" | "stepup-rejected"; // user/runtime reality
  humanVerdict?: "false-endorse" | "false-refuse" | "correct";     // backfilled audit
}
```

The hook is not a new instrument — it **derives from events already emitted**. `audit.ts` already logs `connect.request`, `connect.approve`, `connect.deny`, `token.revoke`, `read`. The eval log is a *projection* keyed by `requestId`/app that joins the curator's decision at request time with the user's `outcome` later. Every `route()` call writes the `decision/friction` half; every `connect.deny`/`token.revoke`/RFC-0005 reject fills the `outcome` half. This is the day-one obligation: **the join key (`requestId`) must be carried from `createConnect` through every downstream audit event** — cheap now, impossible to reconstruct if added late (RFC 0000: "worthless to add late").

### 4.2 Tuning the curator — precision/recall over *discharge decisions*

The success metric is **not** per-app safety — it is the curator's own confusion matrix and the costly middle shrinking (RFC 0000 rule 4):

- **false-endorse** (a closure discharged that the human verdict / a later info-flow proof contradicts) → precision hit. These are the headline failures; each one re-opens the app and bumps it up the portfolio.
- **false-refuse** (a good app steered/dev-moded that humans later wave through) → recall hit; these are friction we overcharged.
- the corpus feeds **which workflow to trust for which app class** (RFC 0004 Part 2: "plural on purpose"). E.g. if LLM-judge discharges on `reddit`-class read-only adapters never false-endorse, the allocator stops escalating them to info-flow — the middle shrinks. If browser-path (b3) plugins false-endorse under LLM-judge, the allocator learns to require level-3 there.
- **auto-demote on drift** (RFC 0000 rule 3): a discharged closure is periodically re-checked against fresh Facts at the current `tree_hash`; a mismatch (app re-promoted, hash moved, observed set grew) demotes the discharge and re-lists the app as "analysis pending."

---

## 5. The agentic curator itself

### 5.1 What the agent is

An LLM agent invoked at **admit time** (a new app requesting listing) and on **allocator triggers** (hot/broad/declined apps). It is a td-0022 *named curator* — its inputs are reproducible (spec, evaluator id+hash, input hashes), its output is per-clause, never an opaque verdict. Its job, the RFC 0003 four-step loop made executable:

1. **Pull verifiability** — resolve the requester's td-0020 evidence bundle → `Facts` (channel, platform `app_id`, per-app binding, `source.tree_hash`). This is the v-axis, sourced not asserted.
2. **Read the code at `tree_hash`** — the plugin handler (`listItems`/`fetchItem`/`scopes[].read`) and its egress. Enumerate credential sinks, outbound hosts, read extents.
3. **Write the capability statement** (§2.2) and run the cheap discharge (LLM-judge, level 1–2), emitting the `Discharge` + closure check (§2.3).
4. **Admit or steer** — write the listing entry, or, if breadth exceeds discharge, register the steer target.

### 5.2 The listing store

A persisted catalog, same pattern as `connect.json`/`tokens.json` (`Record<id, …>` + `Deno.writeTextFile`), served at a new `GET /api/listings` (mirrors `GET /api/plugins`, `handler.ts:333`) and consulted by `createConnect` to enforce "an app must be listed to be consumable" (the M2 acceptance) — while a listed app **still** requires the per-user `connect()` grant (layer 2 is untouched):

```ts
interface Listing {
  id: string; plugin: string; scope?: string;
  statement: CapabilityStatement; discharge: Discharge;
  attestation?: string;     // td-0020 bundle URL
  status: "pending" | "listed" | "steered" | "demoted";
  steerTo?: string;         // when a broad ask was consolidated
}
```

The MVP (issue #23) hand-edits this file. Phase 1+ has the agent write it. Both produce the *same* `Listing` shape — the agent is a drop-in author, not a new mechanism.

### 5.3 The convergence-nudge — concrete

`consolidatedPatternFor(plugin, scope)` (§1.2) reads a counter the curator maintains: **listings grouped by `(plugin, scope-signature)`**, where the scope-signature is the structured-shadow read/egress set of the statement. When the **Nth (N=3) app** requests the same plugin at a broader-than-necessary breadth and a narrower listed `scope` already covers its actual reads:

- the curator emits a **steer** (`route()` returns `steered`, the approve page leads with the narrower reviewed scope), and
- it files a **promotion proposal**: "3 apps now read Otter transcripts; promote `otter.list` (titles+timestamps) as the paved scope." This is RFC 0003's "you're the 3rd app reading Otter — here's the shared path," and it is where a `plugin.scopes[…]` entry (§2.4) gets *born* from observed demand rather than designed up front (the ROADMAP Model's "convergence is opportunistic, not designed-in").

The nudge is **soft**: it never blocks the broad ask outright (that would be a rigid choke point the ROADMAP forbids) — it makes the narrow path the cheap default and the broad path the explicit one.

---

## 6. Phasing + open questions

### 6.1 Growth from the static-listing MVP

| phase | what ships | verifiability ceiling | gated on |
|---|---|---|---|
| **0 — MVP (issue #23)** | hand-edited `Listing` store; `connect` checks listing exists | v1 (self-described) | nothing |
| **1 — statements + cheap discharge** | `CapabilityStatement` on `Plugin`; LLM-judge writes + discharges (level 1–2); eval-corpus hook live; `route()` + matrix wired into `createConnect`/`approvePage` | v2 | nothing host-side; pure oauth3 |
| **2 — consume attestation** | resolve `req.attestation` → td-0020 Facts; closure binds to `tree_hash`; breadth gating real (b3/b4 reachable) | v3 (attested) | `INSTANCE_MODE=attested` + per-app Facts |
| **3 — agentic curator** | agent auto-admits, auto-writes statements, runs convergence-nudge; td-0022 curator spec published | v3 | td-0022 evaluator available |
| **4 — premium + enforced** | info-flow discharge (level 4); egress-lock *enforced* by the sandbox, not merely claimed | v4 (curated) | sandbox egress allowlist (RFC 0003 deferred) |

Each phase keeps the cheap default always-correct-enough and never blocks on the premium path (RFC 0000 rule 1). The matrix and the eval corpus exist from **phase 1** — the agent in phase 3 is a better *author* of the same `Listing`/`Discharge`/`EvalEntry` records, not a new control surface.

### 6.2 What is gated on the tee-daemon attestation surface

The whole **v3/v4 column of the matrix is dark until the host exposes per-app verifiability.** Concretely, td-0020's own caveat: in a shared instance the TDX quote attests *the webhost daemon*, not each app — the daemon vouches "project P = `tree_hash` H." So today `verifiabilityOf` tops out at **"the daemon vouches for this source binding"**, which is enough for v3 *of the binding* but not a hardware quote of the app itself. A per-app hardware quote needs a per-app CVM (RFC 0019) — a deployment-granularity choice, out of scope here. Until then:

- **b4 raw-jar** and **b3 browser** broad grants are reachable **only through dev-mode**, never trivial — the matrix's bottom rows stay friction-bound, exactly as RFC 0003 wants.
- `INSTANCE_MODE` is `"dev"` on the current pod (`home-page.ts:111`); the verifiability axis is artificially capped at v1–v2 for the instance itself until it flips to `"attested"`.

### 6.3 Open questions

1. **Automatable vs. summarized closure-check.** RFC 0003's open question, sharpened: §2.3's subset test is mechanical *only* under info-flow (level 4); under LLM-judge it is a claimed observed set. How much of "does the code satisfy its closure" is daemon-checkable (egress allowlist enforced by the sandbox → closure *enforced*) vs. a guided human read? Phase 4's enforced egress-lock is the first step from *claimed* to *enforced*.
2. **Scope-signature equivalence.** The convergence-nudge (§5.3) groups by structured-shadow read/egress sets — but two statements can describe the same reads in different words. Do we canonicalize the shadow (so `titles+timestamps` ≡ `metadata`) or compare LLM-embeddings? Wrong grouping = missed or spurious nudges.
3. **Per-app vs per-daemon quote granularity** (§6.2) — when does an app earn a per-app CVM (RFC 0019) vs. ride the daemon binding? Likely allocator-driven: only the hottest/broadest apps justify the per-app deployment cost.
4. **Demotion blast radius.** A decline demotes a discharge (§3.3) — but a `Listing` is consumed by many users' live tokens. Does demotion revoke outstanding tokens, or only raise friction on *new* grants? (Lean: new grants only; live tokens fall to RFC 0005 runtime step-up.)
5. **Consent profiles (deferred, RFC 0004).** The demand-side mirror — "Alice always declines GPS, don't ask" handed to the curator as a hint so the negotiation resolves before bothering the user. Its own thread; it plugs into `route()` as a pre-filter that can pre-decide `informed-tap` cells.

### 6.4 Out of scope

- The concrete td-0020 evidence-bundle schema and the td-0022 spec language (host-side; consumed, not re-derived here).
- Runtime step-up (RFC 0005) — the *invocation*-time third layer; this RFC is listing-time (layer 1). They share the eval-corpus discipline and the decline→demote edge.
- Proving the LLM-judge sound (td-0022 out-of-scope) — this design requires reproducible inputs, evaluator identity, and per-clause evidence pointers, not a soundness proof.
