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
  };

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
