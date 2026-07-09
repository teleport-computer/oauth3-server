// Composable "scope ingredients" — the credential dial made legible and enforceable.
// A token's caps may name one or more ingredients; each ingredient whitelists a set of
// read kinds (the endpoint chokepoints in handler.ts). A token that carries NO ingredient
// cap is unrestricted (scopeReads → null) so owner + every legacy token keep reading
// everything — backward compatible. A token that carries ingredient caps is confined to
// the UNION of those ingredients' reads. RFC 0003/0004 (attenuated delegation).

export const SCOPE_INGREDIENTS: Record<string, { plugin: string; reads: string[]; label: string }> =
  {
    "otter:live-follow": {
      plugin: "otter",
      reads: ["live", "frame"],
      label:
        "read-only · the current live meeting · not your conversation list, transcript text, or recap",
    },
    "reddit:karma": {
      plugin: "reddit",
      reads: ["account"],
      label:
        "read-only · your Reddit account identity (username) and karma (comment + link) · not your saved posts, feed, votes, or messages",
    },
  };

// Per-plugin capability statements (RFC 0009 step 1) — the operator-authored sentence shown
// on the approve page for informed consent: what a token for this plugin CAN read and CANNOT
// touch. The approve dialog renders `pluginCapability(req.plugin).statement` straight from
// here, and GET /api/scopes surfaces the same list, so the shown sentence can't drift from
// this source (RFC 0004 anti-hollow-green). One entry per in-tree plugin under server/plugins/.
export const PLUGIN_CAPABILITIES: Record<string, { plugin: string; statement: string }> = {
  otter: {
    plugin: "otter",
    statement:
      "CAN read your conversation list, each transcript, the current live meeting's segments and shared-screen frames, and a logged-in screenshot of otter.ai. CANNOT edit, delete, or share anything.",
  },
  youtube: {
    plugin: "youtube",
    statement:
      "CAN read your watch history (videos and Shorts, each flagged isShort) and a logged-in screenshot of youtube.com. CANNOT like, subscribe, comment, remove from history, or upload.",
  },
  reddit: {
    plugin: "reddit",
    statement:
      "CAN read your saved posts and comments (and each item's full body/url), your account identity and karma (comment + link), and a logged-in screenshot of reddit.com. CANNOT save, vote, post, comment, or edit.",
  },
  nytimes: {
    plugin: "nytimes",
    statement:
      "BROWSER-PATH — reads only succeed via the browser (Teleport Computer), not a server-side replay. CAN read your Reading List (saved articles) and a logged-in screenshot of nytimes.com. CANNOT save, subscribe, or edit.",
  },
  twitter: {
    plugin: "twitter",
    statement:
      "BROWSER-PATH — no frozen API. CAN read a logged-in screenshot of your x.com timeline (the only read). CANNOT read the timeline as structured data, tweet, like, retweet, follow, or DM.",
  },
  "google-calendar": {
    plugin: "google-calendar",
    statement:
      "CAN read your upcoming events and a logged-in screenshot of calendar.google.com; a token MAY also carry a write:event:<id> cap to edit ONE named event. CANNOT create or delete events, or edit any event not named in its caps.",
  },
};

// The full plugin-capability ledger (one statement per in-tree plugin). Public/read-only.
export function pluginCapabilities(): { plugin: string; statement: string }[] {
  return Object.values(PLUGIN_CAPABILITIES);
}
// The exact enforced statement for one plugin; undefined when unknown (no drift to a made-up sentence).
export function pluginCapability(plugin: string): { plugin: string; statement: string } | undefined {
  const c = PLUGIN_CAPABILITIES[plugin];
  return c ? { ...c } : undefined;
}

// The enforced ingredient ledger, surfaced for the UX layer (RFC 0004 — closure-can't-drift):
// the scope sentence shown to a user MUST come from here, not an app-authored string, so
// the displayed claim is provably what's enforced at the gate. Public/read-only by design
// (the labels already appear verbatim in the gate's 403 response).
export function scopeIngredients(): { id: string; plugin: string; reads: string[]; label: string }[] {
  return Object.entries(SCOPE_INGREDIENTS).map(([id, ing]) => ({ id, ...ing }));
}
export function scopeIngredient(
  id: string,
): { id: string; plugin: string; reads: string[]; label: string } | undefined {
  const ing = SCOPE_INGREDIENTS[id];
  return ing ? { id, ...ing } : undefined;
}

// null = unrestricted (no scope ingredient present). Otherwise the union of allowed reads.
export function scopeReads(caps?: string[]): Set<string> | null {
  const named = (caps ?? []).filter((c) => c in SCOPE_INGREDIENTS);
  if (named.length === 0) return null;
  const reads = new Set<string>();
  for (const c of named) for (const r of SCOPE_INGREDIENTS[c].reads) reads.add(r);
  return reads;
}

export function scopeLabel(caps?: string[]): string {
  return (caps ?? []).filter((c) => c in SCOPE_INGREDIENTS).map((c) => SCOPE_INGREDIENTS[c].label)
    .join(" · ");
}
