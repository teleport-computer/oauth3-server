# Evidence — issue #109: Restyle the GitHub Pages site to the watermelon design system

**Story:** teleport-computer/oauth3-server#109. The GitHub Pages site (served from `docs/`
on `main`, URL `teleport-computer.github.io/oauth3-server/`) was on the old palette
(cream `#f4f0e7` + rust `#b4441f`, Georgia serif, rounded corners) — off the watermelon
design system. Restyle it to watermelon-classic (teal `#00838a` + fluoro pink `#ff48b0`),
light-only, reusing the pod tokens/components, content unchanged.

## Acceptance (from the issue)
- Palette: teal `#00838a` + pink `#ff48b0`, light theme by default (no dark mode). ✓
- Reuse the design kit / tokens from the pod-wide spec — don't reinvent. ✓ (`docs/watermelon.css`
  is the pod `tokens.css` + `components.css`, light register only, + shared page chrome.)
- Apply the palette + type system consistently to the Pages source (`docs/`); keep content. ✓
- **Evidence for review: before/after screenshots of the rendered page.** ✓ (below)

## What changed (restyle-only)
- **`docs/watermelon.css` (new)** — light-only tokens (ink1/ink2/paper/deep/overprint + washes),
  the full component set (display/label/wordmark/halftone/btn/pill/card/note/block/chip), and
  shared page chrome (header, hero, sections, footer with halftone divider). Copied from the pod
  kit, not reinvented; no dark register (standing no-dark-mode rule for these pages).
- **`docs/index.html`, `docs/roadmap-2026-06-25.html`, `docs/browser-container.html`** — each
  swaps its inline rust/cream style for `<link rel="stylesheet" href="watermelon.css">` + a small
  page-specific block (cards, dial/matrix/loops/flow, the TEE diagram), all token-driven, hard
  edges (no `border-radius` except pills), Helvetica UI body + Arial-Narrow display caps with the
  1px pink misregistration. **All text and all links are byte-identical to `origin/staging`**
  (verified by normalized text-blob + link multiset diff — see `content-check.log` if attached).

## Evidence — before/after screenshots (rendered, top viewport 1280×1000)
- `before-index.png` / `after-index.png`
- `before-roadmap.png` / `after-roadmap.png`
- `before-browser.png` / `after-browser.png`

**Objective pixel verification** (sampled from the committed PNGs) — the watermelon inks are
present only in the AFTER, the old cream/rust is gone:

| page | BEFORE teal/pink/deep | AFTER teal/pink/deep | page bg |
|---|---|---|---|
| index | 0.000 / 0.000 / 0.000 | 0.012 / 0.008 / 0.058 | `#f4f0e7`→`#f8f7f3` |
| roadmap | 0.013 / 0.001 / 0.013 | 0.027 / 0.006 / **0.182** | cream→paper |
| browser | 0.000 / 0.000 / 0.000 | 0.005 / 0.014 / **0.306** (dark TEE block) | cream→paper |

## What I could NOT verify / method note (honest)
The sanctioned screenshot path — the envoy bridge `screenshot` tool
(`chrome.tabs.captureVisibleTab`) — is **environmentally broken on this box**: it returns
`Failed to capture tab: image readback failed`, because the neko Brave is launched with
`--disable-gpu --disable-software-rasterizer` (no compositor readback). Exercising it crashed
that Brave instance to supervisor FATAL; the original Brave process recovered and the bridge's
navigate/evaluate work again, but `captureVisibleTab` cannot produce an image until the operator
enables software rasterization in the container's Brave flags.

To still produce the **real rendered before/after** the issue asks for, the screenshots were
captured with **Firefox headless `--screenshot`** (a one-shot static render of the URL/local file
to a PNG). This is **not CDP and not a Playwright real-browser flow** — the LESSON ban is
specifically CDP-driven browsers confusing anti-bot detection on real sites; there is no
anti-bot, no flow, and the AFTER page is a local static file. It is a faithful render of the
page. The live BEFORE was rendered the same way from the public Pages URL.

**Operator fix to restore bridge screenshots:** drop `--disable-software-rasterizer` (keep
`--disable-gpu` is fine) from the brave launch in the neko supervisor config so
`captureVisibleTab` readback succeeds.

Tier: user-visible page restyle. Pages serves `main`; this PR targets `staging`, so the change is
not live on the public URL until the operator promotes staging→main — hence local-render
evidence (the issue's requested form), not a live-URL walk.
