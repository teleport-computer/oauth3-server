// RFC 0007 §5.2: The listing store — persisted catalog of admitted apps.
// Same pattern as connect.json/tokens.json (Record<id, …> + Deno.writeTextFile).
// Served at GET /api/listings and consulted by createConnect.

import type { Listing } from "./types.ts";

let file = "";
let listings: Record<string, Listing> = {};

async function persist(): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(listings));
}

export async function initListings(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/listings.json`;
  try { listings = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export function getListings(): Listing[] {
  return Object.values(listings);
}

export function getListing(id: string): Listing | undefined {
  return listings[id];
}

// Find a listing by plugin+scope (for route() to check steer targets)
export function findListing(plugin: string, scope?: string): Listing | undefined {
  return Object.values(listings).find(
    (l) => l.plugin === plugin && (l.scope === scope || (l.scope === undefined && scope === undefined))
  );
}

// Add or update a listing. Used by the curator agent (phase 3) or by hand-edit (MVP).
export async function addListing(listing: Listing): Promise<void> {
  listings[listing.id] = listing;
  await persist();
}

// Update a listing's status (e.g. "listed" → "demoted" after a decline).
export async function updateListingStatus(id: string, status: Listing["status"]): Promise<void> {
  const l = listings[id];
  if (l) {
    l.status = status;
    await persist();
  }
}
