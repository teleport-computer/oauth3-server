// Shared pod design system — "constructivist overprint". Inlined once per page that
// needs it (server pages are template literals: import DESIGN_CSS, drop it into a
// single <style>). Source of truth: ~/paseo-batch/specs/design/ (tokens.css +
// components.css). Re-ink by editing the token block below, never hardcode hex in a
// page. Both themes (prefers-color-scheme + data-theme) are handled by the tokens.

export const DESIGN_CSS = `/* ===== tokens.css ===== */
/* oauth3 / pod.dstack — design tokens
   system: CONSTRUCTIVIST OVERPRINT — Rodchenko geometry printed as a two-ink riso.
   primary inking: "watermelon classic"  ink1 #00838a (teal) · ink2 #ff48b0 (fluoro pink)
   Re-ink an app by overriding --ink1/--ink2/--deep (+ dark variants); everything else derives. */

:root {
  --ink1: #00838a;   /* teal — structure, primary actions, ok-status */
  --ink2: #ff48b0;   /* fluoro pink — emphasis, danger, stamps, wedges */
  --paper: #f8f7f3;
  --deep: #123f43;        /* ink1 pulled toward black: body text + dark blocks */
  --overprint: #00255f;   /* ink1 × ink2 multiply — free third color, decorative only */

  --bg: var(--paper);
  --text: var(--deep);
  --faint: color-mix(in srgb, var(--deep) 55%, var(--paper));
  --rule: color-mix(in srgb, var(--deep) 16%, var(--paper));
  --card: #fff;
  --block: var(--deep);       /* enclave/evidence blocks */
  --block-text: #f8f7f3;
  --wash1: color-mix(in srgb, var(--ink1) 15%, var(--paper));
  --wash2: color-mix(in srgb, var(--ink2) 17%, var(--paper));
  --i1-text: #00676d;   /* inks deepened for small text on washes */
  --i2-text: #c2187a;
  --warn: #a8780c;      /* marigold — the ONLY third ink, stale/warn states only */
  --warn-wash: color-mix(in srgb, #e0a41a 22%, var(--paper));

  --sans: "Helvetica Neue", Arial, sans-serif;                /* UI body */
  --cond: "Arial Narrow", "Helvetica Neue", sans-serif;       /* display: 800 uppercase */
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;     /* anything verifiable */

  --off: 1px;   /* misregistration offset — NEVER larger, display text ≥19px only */
}

/* dark register — same inks brightened on marine-black; multiply blends die on dark
   grounds, so overlap devices use solid layering there (components handle it) */
@media (prefers-color-scheme: dark) { :root {
  --ink1: #2fbdc4; --ink2: #ff5fbb;
  --paper: #0e1f21; --deep: #081517;
  --bg: #0e1f21; --text: #e9f0ee;
  --faint: color-mix(in srgb, #e9f0ee 55%, #0e1f21);
  --rule: color-mix(in srgb, #e9f0ee 14%, #0e1f21);
  --card: #142829; --block: #081517; --block-text: #e9f0ee;
  --wash1: color-mix(in srgb, #2fbdc4 20%, #0e1f21);
  --wash2: color-mix(in srgb, #ff5fbb 20%, #0e1f21);
  --i1-text: #5fd3d9; --i2-text: #ff8ccb;
  --warn: #e0b34a; --warn-wash: color-mix(in srgb, #e0a41a 18%, #0e1f21);
} }
:root[data-theme="dark"] {
  --ink1: #2fbdc4; --ink2: #ff5fbb;
  --paper: #0e1f21; --deep: #081517;
  --bg: #0e1f21; --text: #e9f0ee;
  --faint: color-mix(in srgb, #e9f0ee 55%, #0e1f21);
  --rule: color-mix(in srgb, #e9f0ee 14%, #0e1f21);
  --card: #142829; --block: #081517; --block-text: #e9f0ee;
  --wash1: color-mix(in srgb, #2fbdc4 20%, #0e1f21);
  --wash2: color-mix(in srgb, #ff5fbb 20%, #0e1f21);
  --i1-text: #5fd3d9; --i2-text: #ff8ccb;
  --warn: #e0b34a; --warn-wash: color-mix(in srgb, #e0a41a 18%, #0e1f21);
}
:root[data-theme="light"] {
  --ink1: #00838a; --ink2: #ff48b0;
  --paper: #f8f7f3; --deep: #123f43;
  --bg: #f8f7f3; --text: #123f43;
  --faint: color-mix(in srgb, #123f43 55%, #f8f7f3);
  --rule: color-mix(in srgb, #123f43 16%, #f8f7f3);
  --card: #fff; --block: #123f43; --block-text: #f8f7f3;
  --wash1: color-mix(in srgb, #00838a 15%, #f8f7f3);
  --wash2: color-mix(in srgb, #ff48b0 17%, #f8f7f3);
  --i1-text: #00676d; --i2-text: #c2187a;
  --warn: #a8780c; --warn-wash: color-mix(in srgb, #e0a41a 22%, #f8f7f3);
}

/* alternate inking: "grape acid" — for sibling apps (e.g. webhost). Same system.
:root { --ink1:#6f57a8; --ink2:#b5d33d; --deep:#2e2745; --overprint:#31491f;
        --i1-text:#5a4590; --i2-text:#6d8317; }                                  */

/* ===== components.css ===== */
/* oauth3 / pod.dstack — component conventions (requires tokens.css) */

body { background: var(--bg); color: var(--text); font: 15px/1.6 var(--sans); }
a { color: var(--i1-text); }
:focus-visible { outline: 2px solid var(--ink2); outline-offset: 2px; }

/* display: condensed 800 caps, ink1 with a 1px ink2 print-offset (≥19px text only) */
.display { font: 800 clamp(30px, 5.5vw, 54px)/0.94 var(--cond); text-transform: uppercase; margin: 0; color: var(--ink1); text-shadow: var(--off) var(--off) 0 var(--ink2); text-wrap: balance; }

/* labels: lowercase mono, wide tracking */
.label { font: 500 11px/1 var(--mono); letter-spacing: .16em; text-transform: lowercase; color: var(--faint); }

/* wordmark: seal + lowercase name, ink2 numeral */
.wordmark { display: inline-flex; align-items: center; gap: 10px; font: 800 20px var(--sans); letter-spacing: -.01em; color: var(--text); }
.wordmark img { width: 28px; height: 28px; }
.wordmark b { color: var(--i2-text); font-weight: inherit; }

/* seal on a halftone disc with a slipped ring (hero use, ~110px) */
.disc { position: relative; width: 110px; height: 110px; flex: none; }
.disc::before { content: ""; position: absolute; inset: -11px; border-radius: 50%; background: radial-gradient(circle, var(--ink2) 42%, transparent 46%) 0 0/8px 8px; }
.disc::after { content: ""; position: absolute; inset: -11px; border-radius: 50%; border: 3px solid var(--ink1); transform: translate(3px, 2px); }
.disc img { position: relative; width: 100%; height: 100%; }

/* the wedge: halftone ink2 over a misregistered solid ink1 copy (section divider, hero) */
.wedge { position: relative; height: clamp(60px, 12vw, 110px); max-width: 580px; }
.wedge i { position: absolute; inset: 0; clip-path: polygon(0 0, 100% 50%, 0 100%); }
.wedge i.under { background: var(--ink1); transform: translate(5px, 4px); }
.wedge i.over { background: radial-gradient(circle, var(--ink2) 42%, transparent 45%) 0 0/8px 8px; }

/* halftone divider band */
.halftone { height: 12px; border-radius: 2px; background: radial-gradient(circle, var(--ink1) 34%, transparent 36%) 0 0/9px 9px, radial-gradient(circle, var(--ink2) 30%, transparent 32%) 4px 5px/9px 9px; }

/* buttons: hard-edged, two-ink shadows; no border-radius in this system */
.btn { display: inline-flex; align-items: center; gap: 8px; font: 800 14px var(--cond); text-transform: uppercase; letter-spacing: .12em; border: 0; padding: 12px 22px; cursor: pointer; background: var(--ink1); color: #fff; box-shadow: 3px 3px 0 var(--ink2); }
.btn.ghost { background: transparent; color: var(--i1-text); border: 3px solid var(--ink1); box-shadow: none; }
.btn.danger { background: var(--ink2); color: var(--deep); box-shadow: 3px 3px 0 var(--ink1); }
.btn.quiet { background: transparent; color: var(--text); border: 1px solid var(--rule); box-shadow: none; font: 600 13px var(--sans); letter-spacing: 0; text-transform: none; }

/* attestation badge (solid, on cards) + stamp (outline, rotated — hero/evidence use) */
.badge { font: 800 13px var(--cond); text-transform: uppercase; letter-spacing: .28em; background: var(--ink2); color: var(--deep); padding: 8px 14px 8px 17px; }
.stamp { display: inline-block; font: 800 13px var(--cond); text-transform: uppercase; letter-spacing: .24em; color: var(--i2-text); border: 3px solid var(--i2-text); padding: 7px 12px 7px 15px; transform: rotate(-3deg); }
.stamp.ok { color: var(--i1-text); border-color: var(--i1-text); }

/* status pills — mono; ok/warn/bad only (warn = the one third ink) */
.pill { display: inline-flex; align-items: center; gap: 6px; font: 500 12px/1 var(--mono); padding: 4px 10px; border-radius: 999px; }
.pill.ok   { background: var(--wash1); color: var(--i1-text); }
.pill.warn { background: var(--warn-wash); color: var(--warn); }
.pill.bad  { background: var(--wash2); color: var(--i2-text); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dot.ok { background: var(--ink1); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--ink2); }

/* surfaces: card = white panel with ink1 frame; note = quiet wash */
.card { background: var(--card); border: 2.5px solid var(--ink1); padding: 16px 18px; }
.card b.title { font: 800 16px var(--cond); text-transform: uppercase; letter-spacing: .08em; }
.note { background: var(--wash1); border-left: 6px solid var(--ink1); padding: 12px 14px; font-size: 14px; }

/* enclave/evidence block: TEE content renders on --block with an ink2 spine, mono */
.block { background: var(--block); color: var(--block-text); border-left: 12px solid var(--ink2); padding: 16px 20px; font: 13px/1.7 var(--mono); overflow-x: auto; }
.block .hit { color: color-mix(in srgb, var(--ink2) 55%, #fff); }
.block .k { opacity: .55; display: inline-block; min-width: 8ch; }

/* anything verifiable is a mono chip */
.chip { font: 12px var(--mono); background: var(--wash1); color: var(--i1-text); padding: 2px 7px; }

/* thin meters (jar freshness etc.) */
.meter { display: grid; grid-template-columns: 16ch 1fr 6ch; gap: 12px; align-items: center; font: 11px var(--mono); color: var(--faint); }
.meter .track { height: 4px; background: var(--rule); position: relative; }
.meter .track i { position: absolute; inset: 0 auto 0 0; background: var(--ink1); }
.meter .track i.warn { background: var(--warn); }

/* vertical side-label (decorative, one per page max) */
.side { font: 800 12px var(--cond); text-transform: uppercase; letter-spacing: .4em; color: var(--ink2); writing-mode: vertical-rl; }`;
