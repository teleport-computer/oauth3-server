# RFC 0000: Opportunistic spend & feedback loops (shrink the costly middle)

## Summary
A cross-cutting design discipline the OAuth3 RFCs share, named once so future loops
inherit it instead of re-deriving it. Wherever there is a **cheap-but-imperfect
default** and a **better-but-expensive path**, do not choose one globally. Keep the
cheap default; let a **learned allocator** pay for the expensive path only where it
earns its keep — keyed to usage or risk — and collect a **feedback corpus from day
one** so the expensive path is needed *less often* over time. The costly middle shrinks.

This is the ROADMAP's "opportunistic convergence" generalized from adapters to every
spend in the system.

## The pattern (three current instances)
The spent resource differs each time; the structure is identical.

| loop | cheap default | expensive path | allocator (triggers the spend) | feedback that shrinks the middle | resource |
|---|---|---|---|---|---|
| **audit-spend** — RFC 0004 / td-0021,0022 | LLM-judge / self-described | info-flow proof · human "safe" review | usage · power · declines | eval corpus → better discharge → less re-auditing | audit tokens |
| **adapter reification** — RFC 0001 | browser + screenshot (correct, dear) | reversed replayable API scope | hotness (invocation count) | validate vs browser ground truth; auto-demote on drift | reverse-engineering tokens |
| **runtime step-up** — RFC 0005 | auto-approve / auto-reject | bother the user out-of-band | risk/novelty of *this* invocation | learn from approve/deny → narrower middle | user attention |

## The discipline (what every loop must do)
1. **A cheap default that's always correct-enough** — never block on the expensive
   path (browser ground-truth; auto-approve/reject; the LLM-judge first pass).
2. **An allocator keyed to a real signal of worth** — hotness, usage/power/declines,
   risk/novelty. Spend is opportunistic, never uniform.
3. **Validate against ground truth where one exists** — reified scope vs the browser;
   a discharged claim vs the attested facts — and **auto-demote on drift**.
4. **A feedback corpus from day one** — `(input, decision, outcome, ground-truth /
   human verdict)`, especially the failures. The success metric is **the middle
   shrinking** (fewer expensive invocations at constant safety/quality), not raw
   throughput. "Did we wire the corpus hook?" is a standing checklist item, not an
   afterthought — it is worthless to add late (you can't tune against data you didn't
   start collecting).
5. **No silent weakening.** The cheap path may be *wrong*, but it must never be *less
   safe* than the expensive path would have been — when unsure, **escalate, don't fall
   back**. (Same principle as the project-wide no-fallback rule: surface/escalate,
   never mask.)

## Why name it
Three loops with one shape is a discipline, not a coincidence. Naming it means: future
loops conform by default, the day-one-corpus obligation is explicit, and reviewers have
one place to check a new loop against ("which is the cheap default, what's the
allocator, where's the corpus, does it escalate-not-fallback?").

## Relationship
Instances: RFC 0001 (reification), RFC 0004 (audit-spend), RFC 0005 (runtime step-up).
The deferred **consent profiles** (Alice/Bob) is a fourth in spirit — spending a
pre-stated preference to avoid spending user attention later.
