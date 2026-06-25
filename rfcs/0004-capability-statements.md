# RFC 0004: Capability statements + the curation portfolio

## Summary
The RFC 0003 curator has a policy (breadth × verifiability → friction) but no
**language to speak** and no **way to earn verifiability**. This RFC supplies both:

1. a **vocabulary** of capability statements — soft guidance for writing the legible,
   *generative* claims a user approves ("what an app does, **and nothing more**");
2. a **portfolio of verification workflows** at different cost/confidence points that
   *discharge* those claims — chosen opportunistically by usage/power/risk, **not one
   expensive gate**;

plus the recognition that the curation workflow is itself tunable, so we plan a
**feedback/eval corpus from day one**.

## Part 1 — Capability statements (the vocabulary)

A capability statement is the human-legible claim the user actually approves. Two
independent parts: **what it says** (this part) and **how strongly it's backed**
(Part 2's ladder). "safe" is not a statement shape — it is the top rung of the ladder.

- **Generative, not prescriptive.** A coding agent writes a precise sentence per app
  ("anything can be explained in a precise language"). The vocabulary below is a
  **thinking/writing guide for the range of claims** — not a schema apps must conform
  to. It guides *how we write and explain*, it doesn't constrain wording.
- **Closure is the load-bearing element.** "only", "and that's all", "nothing else".
  A statement of what an app *does* is marketing; what it does **and nothing more** is
  a contract. Every good statement carries a closure.

Shape exemplars (a guide, not an enum):

| shape | what it asserts | examples |
|---|---|---|
| **flow** | where your credential goes *inside the code* | "Your Otter cookie reaches only the transcript-export call." · "Your YouTube cookie is used only to query watch history." |
| **read** | what data + extent | "Reads **all** your watch history." · "Reads Otter transcript **titles and timestamps** — not the text." · "Lists your saved Reddit posts." |
| **action** | what it does on your behalf | "Posts nothing." · "Read-only — never writes." · "Saves to your TinyCloud." |
| **egress / closure** | what leaves, to where | "Results go **only** to your TinyCloud." · "Shown on your screen; the app keeps no copy." |
| **negative** | explicit *does-not* (often the most reassuring) | "Never reads your DMs." · "Never sees your password." |
| **code-property** | a property of the running code, not the data | "Nothing leaves the TEE." (reads differently to a user than a data claim — tag it as code-level, don't lump with "reads watch history") |
| **holistic** | bounded & unsurprising *overall* | "Curated safe." → top rung only; implies judgment beyond automated review |

## Part 2 — The verification portfolio (how claims get discharged)

Ordered cheap → premium by token/effort cost. **Escalation is a policy, not a
default**: start cheap, spend the premium pass only where it pays (hot, powerful, or
contested apps). This is RFC 0001's opportunistic-spend ethos applied to curation —
don't pay for proof on an app nobody uses.

| workflow | cost | discharges | source of trust |
|---|---|---|---|
| **LLM judge reads the code** | cheap — the always-available first pass | rough/specific claims, low assurance | a model's read of the code |
| **developer-supplied evidence** | shifted to the developer | specific, audit-ready claims | the dev pays the upfront documentation cost so the auditor spends fewer hours for the same quality (good docs → cheaper audit) |
| **trust-by-construction** | cheap *if the app is born here* | strong claims | the app was generated through our checker from a one-shot prompt, **alongside its co-generated safety analysis** — you trust the construction, not a post-hoc audit. The cheapest strong tier and the one we control most; worth treating as a first-class path. |
| **information-flow proven** | **premium (high token)** — last, not first | precise-path claims: "the cookie reaches only F; F only hits the watch-history endpoint; egress only to your TinyCloud" | mechanical taint/flow analysis of the code |

Notes:
- **Declines/incidents bump an app up the portfolio** and can re-open a "safe" rating.
  Usage raises the bar.
- The portfolio is **plural on purpose** — different app classes are best served by
  different workflows; which one to trust for which class is itself something we tune
  (Part 3).

## Part 3 — Discharge ladder (confidence, independent of workflow)

What the *user* sees as the strength of backing, regardless of which Part-2 workflow
produced it:

0. **uncurated / dev-mode** — no backing; the user owns the grant.
1. **analysis pending** — listed and usable, not yet analyzed.
2. **claim discharged** — a Part-2 workflow backs the specific claim.
3. **attested** — the discharged claim is bound to the running code's measurement.
4. **curated "safe"** — holistic human judgment + usage/reputation; not automatable;
   rare; re-opened by declines/incidents.

Most everyday legible claims land at 2–3 (a cheap workflow + attestation). "safe" is
reserved for 4 — exactly because it implies a holistic judgment you wouldn't make from
automated review alone.

## Part 4 — Tuning from day one (the eval corpus)

The workflow **will** be wrong sometimes; plan to tune it rather than pretend it's
fixed. From the start, collect a corpus of:

> `(app, claimed statement, workflow used, discharge decision, outcome, human verdict)`

— positive **and** negative, with special attention to **workflows that worked
poorly**: a claim discharged that shouldn't have been (false endorse), or a good app
over-flagged (false refuse). This corpus is the **success-measurement instrument for
the curator itself** — precision/recall of discharge decisions, not just per-app
outcomes — and it feeds back into which portfolio workflow to trust for which app
class. Build the collection hook before the curator is load-bearing.

## Relationship to other RFCs
- **RFC 0003** — this is the *language* the curator speaks and the *machinery* that
  earns verifiability. 0003 = policy (breadth × verifiability → friction); 0004 =
  vocabulary + the workflows behind "verifiability".
- **Host layer (`tee-daemon/rfcs`)** — the verification portfolio is the app-layer face
  of: **0021** (app self-improvement / evidence-spend = trust-by-construction + evidence
  cultivation), **0022** (spec-based appraisal = the evaluator that discharges claims
  against a curator spec), **0020** (the facts a discharged claim binds to). The
  capability-statement *vocabulary* and the cheap-first *escalation policy* are the
  OAuth3 delta; the evidence/appraisal machinery is host-side — consume it.
- **RFC 0001** — same opportunistic-spend principle: expensive analysis only where it
  pays.
- **RFC 0000** — the audit-spend portfolio is one of the three named instances of the
  shrink-the-costly-middle loop; Part 4's eval corpus is that loop's day-one obligation.

## Out of scope / deferred
- **Consent profiles** (the Alice/Bob user-side pre-negotiation: a user's preferences
  handed to the app/curator as a hint so the negotiation resolves *before* bothering
  the user — "Alice always declines GPS, don't ask"). The demand-side mirror of the
  curator. Its own thread.
- The concrete attestation surface the daemon exposes (gated on dstack-webhost; likely
  RFC 0005).
