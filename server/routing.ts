// RFC 0007 §1.2-1.3: The routing function — breadth × verifiability → Friction.
// This is the core decision logic that lives in front of the unchanged mint handshake.

import type { CapabilityStatement, Friction, RouteResult } from "./types.ts";
import { findListing } from "./listings.ts";
import { getPlugin } from "./plugins/registry.ts";

/**
 * Breadth levels (RFC 0007 §1.1, X axis).
 * b0 login       — identity only, zero data (mint not called, session only)
 * b1 narrow      — one named capability of a plugin
 * b2 plugin-wide — listItems + fetchItem over the jar (today's default token)
 * b3 rendered    — /screenshot, cookie rides a live browser
 * b4 raw         — the jar itself handed out (gated to dev-mode)
 */
type Breadth = "b0" | "b1" | "b2" | "b3" | "b4";

/**
 * Verifiability levels (RFC 0007 §1.1, Y axis; RFC 0004 Part-3 ladder).
 * v0 dev-mode     — unverifiable
 * v1 self-desc    — capability statement exists, no discharge yet
 * v2 discharged   — Part-2 workflow backs the statement
 * v3 attested     — discharged statement binds to td-0020 Facts
 * v4 curated      — td-0022 verdict passes curator spec + human sign-off
 */
type Verifiability = "v0" | "v1" | "v2" | "v3" | "v4";

/**
 * Map a requested scope string to a Breadth level. (RFC 0007 §1.1)
 * Default (no scope) = b2 plugin-wide read.
 */
function breadthOf(scope: string | undefined, pluginId: string): Breadth {
  const plugin = getPlugin(pluginId);
  if (!plugin) return "b2"; // fallback

  if (scope === "login") return "b0";
  if (scope && plugin?.scopes?.[scope]) return "b1"; // narrow reviewed scope
  if (scope === "browser" || scope === "screenshot") return "b3";
  if (scope === "raw" || scope === "jar") return "b4";
  return "b2"; // default = plugin-wide read
}

/**
 * Resolve an attestation URL to a Verifiability level. (RFC 0007 §1.1)
 * In phase 1, we only support v0-v2 (no td-0020 integration yet).
 */
function verifiabilityOf(attestation: string | undefined, pluginId: string): Verifiability {
  const listing = findListing(pluginId);
  if (!listing) return "v0"; // no listing = dev-mode/unverifiable
  if (!listing.discharge) return "v0";

  // Phase 1: only v1 (self-described) and v2 (discharged) are reachable
  // v3+ require td-0020 Facts (phase 2)
  if (listing.discharge.level === 1) return "v1";
  if (listing.discharge.level >= 2) return "v2";
  return "v0";
}

/**
 * The price of breadth in verifiability. (RFC 0007 §1.2)
 * Monotonic threshold: higher breadth requires higher verifiability.
 */
const required: Record<Breadth, Verifiability> = {
  b0: "v0",
  b1: "v1",
  b2: "v2",
  b3: "v3",
  b4: "v4",
};

/**
 * The routing function — breadth × verifiability → Friction. (RFC 0007 §1.2)
 * Returns { friction, steerTo?, reason }.
 */
export function route(pluginId: string, scope?: string, attestation?: string): RouteResult {
  const b = breadthOf(scope, pluginId);
  const v = verifiabilityOf(attestation, pluginId);
  const need = required[b];

  // Phase 1: v3/v4 are not reachable, so we treat them as "max verifiability"
  // for the purpose of the matrix (effectively v2+).
  const effectiveV = (v === "v3" || v === "v4") ? "v2" : v;

  // Verifiability exceeds need → trivial (above the diagonal)
  if (effectiveV > need) {
    return { friction: "trivial", reason: "verifiability exceeds breadth" };
  }
  // Verifiability meets need → informed-tap (on the diagonal)
  if (effectiveV === need) {
    return { friction: "informed-tap", reason: "breadth priced, show the statement" };
  }

  // Under-verified: check for a paved narrower scope (consolidated pattern)
  // RFC 0007 §5.3: convergence nudge
  const plugin = getPlugin(pluginId);
  if (plugin?.scopes) {
    // Find a listed narrow scope (b1) for this plugin
    for (const [scopeName, scopeData] of Object.entries(plugin.scopes)) {
      const narrowListing = findListing(pluginId, scopeName);
      if (narrowListing && narrowListing.status === "listed") {
        // This is a paved path — steer to it
        return {
          friction: "steer",
          steerTo: scopeName,
          reason: `a reviewed narrower scope (${scopeName}) exists`,
        };
      }
    }
  }

  // No paved path: dev-mode (the explicit, audited, human-owns-it escape hatch)
  return { friction: "dev-mode", reason: "broad + unverifiable; the human owns this grant" };
}

/**
 * Check if a listing exists for this plugin/scope. (RFC 0007 M2 acceptance)
 * Returns false if no listing — the request should be rejected before routing.
 */
export function isListed(pluginId: string, scope?: string): boolean {
  const listing = findListing(pluginId, scope);
  return !!listing && (listing.status === "listed" || listing.status === "steered");
}
