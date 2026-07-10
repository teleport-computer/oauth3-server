# RFC 0010: Ambient Intake — Meetings as a Task Source

**Status**: Draft

## Summary
The operator's spoken feedback in recorded meetings is already concrete task material, and none
of it reaches the swarm. Define an **ambient intake** pipeline: mine Otter transcripts for the
operator's own directives, complaints, and convictions → file them as `proposed` issues with
verbatim provenance → confirm out-of-band (Matrix) → promote to `ready`, where the existing
swarm machinery takes over unchanged. The consent and information-flow rules are the substance
of this RFC: a recorder in a meeting must never auto-publish.

At the limit, if this works perfectly: the operator expresses conviction about an idea in a live
meeting, the swarm is available, and it races him to completion in the meeting itself. At the
minimum: the feedback becomes overnight work instead of evaporating.

## Evidence (the 2026-07-09 exercise, run by hand)
Mining 11 recent transcripts via `GET /api/otter/items` produced 21 classifiable moments —
UX complaints, bug reports, demo ideas, explicit build requests. Two matter here:

- The operator, on record (2026-07-08), about timeline-peek: *"I don't like that I have to go
  click this again, so hopefully it fixes itself overnight... I should not have to do any further
  intervention."* It did not fix itself overnight — no issue was ever filed. The same recording:
  the swarm stayed busy 45 minutes after he went to bed, then sat idle nine hours with an empty
  queue. The expectation and the idle capacity never met. That gap is this RFC.
- The pilot output: webhost-apps issues #28 (timeline-peek re-click), #29 (otterpilot mobile),
  #30 (conversation call stack) were filed by hand from the mining, each with a Provenance
  section. They are the format this pipeline should produce automatically.

## Design

**Producer, not machinery.** Ambient intake is a new source of `ready` issues. `tick.sh`, the
worker specs, `ready-to-merge`, and the merge gates do not change.

**The listener is an oauth3 consumer app.** It reads transcripts through a scoped token carrying
the `otter:live-follow` ingredient (or a batch-read sibling) — never the raw Otter cookie, every
read gated and audited. The swarm's ears get the same credential dial as any third-party app.

**Only the operator's utterances are candidates.** Subject alignment, same rule as the vault:
other participants' speech is context, never a directive. Meeting scope (participants, inferred
by the otterpilot workflow) selects the policy tier; unknown-participant meetings default to the
most conservative one.

**Classification tiers, erring toward drop.**
1. explicit directive ("please one-shot it") — strongest candidate
2. conviction / repeated want ("what I really want is…") — candidate
3. complaint about our own apps — candidate, filed as bug
4. riff, joke, speculation — dropped. Recall is cheap; real wants recur across meetings.

**Propose, never act.** Mined moments become issues labeled `proposed`, never directly `ready`.
This is the `promoter.ts` pattern (PR #74) retargeted from gate-audit events to transcript
events. Promotion `proposed` → `ready` requires an out-of-band confirm — a Matrix message to the
operator ("about to take on: X — veto?") via the hermes bot. RFC 0005's step-up gate, applied to
the swarm itself. Initially, silence is a veto; a timed silence-consent window is a later tier,
earned.

**Provenance is mandatory.** Every filed issue cites transcript, date, and a short verbatim
quote, so "why did the swarm do this" always has an answer, and corrections accumulate as the
feedback corpus (RFC 0000).

**Information-out budget.** The repos are public; the transcripts are not. The leak risk is not
wrong tasks, it's meeting content in issue text. Quotes are minimized (one sentence, no
participant names), and each meeting-scope class carries a budget on how much transcript content
may leave — the operator's own framing, on record 2026-07-09: the quota to enforce is on
information going out, counted only when it's judged important.

## Escalation ladder (autonomy is earned, not configured)
- **Phase 0** — manual exercise. Done; see Evidence.
- **Phase 1** — nightly miner files `proposed` + sends a Matrix digest. Operator confirms by reply.
- **Phase 2** — confirmed classes auto-promote to `ready` with a veto window.
- **Phase 3** — live: poll `/api/otter/live` mid-meeting, Matrix warning, swarm starts while the
  meeting is still running.
Promotion between phases is justified by measured precision on the prior phase (RFC 0000's
allocator discipline: cheap conservative default, spend autonomy only where the corpus earns it).

## Relation to existing work
- RFC 0000 (feedback corpus + allocator), RFC 0001 (reification loop), RFC 0005 (step-up seam).
- `server/promoter.ts` — the in-repo propose-don't-act precedent.
- td-0030 — what the swarm builds from mined tasks still has to verify, not ping.
- td-0031 — resource availability decides *when* this queue drains; "the swarm is available right
  now" is the other half of the racing-me-to-completion story.

## Non-goals
- Acting on any participant's speech other than the operator's.
- Publishing transcript content beyond the minimized provenance quote.
- Replacing operator-filed issues; this adds a source, it does not gate one.

## Lessons from the first live run (2026-07-09 — operator grade: C)
The pipeline ran the same day this RFC was drafted: one spoken request ("Reddit karma
indicator") became two provenance-cited issues, survived the veto window, was built by two
chips, auto-merged, and reached a working deployed app. The grade is a C, not an A, for
reasons that are now requirements:

1. **Acceptance must be user-observable.** The mined issues carried no success condition, so
   the workers' "done" was PR-merged — the app then sat at 404, and later showed mock data,
   both technically "complete." Mined issues now REQUIRE an `## Acceptance` section (what a
   person sees, at what URL, after what action) and an `## Operator steps` section naming
   anything the swarm cannot do itself. This is td-0030's rule applied at intake time.
2. **One utterance, two repos, no contract.** The app chip and the plugin chip invented
   different endpoint names (`/karma` vs `/account`). When one utterance yields tasks in
   multiple repos, the intake must state the interface contract identically in every issue.
3. **Merged ≠ deployed ≠ working.** Merges changed nothing a user could see until an agent
   hand-deployed twice. A post-merge deploy lane for registered static apps is filed; until
   it lands, `## Operator steps` must name the deploy.
4. Human hands were needed at four points: core promotion (correct — by design), two app
   deploys (gap #3), and the contract fix (gap #2). Only the first should survive.
