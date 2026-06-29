// A plugin wraps one site's unofficial API. The server holds the user's whole
// cookie jar for that site (synced by the extension) and the plugin turns it into
// list/fetch reads. This is the seam openfeedling's `shortCheck(cookies)` became.

import type { CapabilityStatement, Jar } from "../types.ts";

// Re-export Jar for backward compatibility with imports from "./plugins/types.ts"
export type { Jar };

export interface PluginItem {
  id: string;
  title: string;
  date?: string; // ISO
  meta?: Record<string, unknown>;
}

export interface Plugin {
  id: string; // url-safe, e.g. "otter"
  label: string; // human, e.g. "ShapeRotator (Otter.ai)"
  cookieDomains: string[]; // extension grabs the WHOLE jar for these, e.g. [".otter.ai"]
  renderUrl?: string; // page to load for /screenshot; defaults to https://www.<cookieDomain>
  loggedIn(jar: Jar): boolean; // cheap presence check on a key cookie
  listItems(jar: Jar): Promise<PluginItem[]>;
  fetchItem(jar: Jar, id: string): Promise<unknown>;
  // Optional live-follow surface: the currently-live item's recent segments (with
  // monotonic `order` for incremental polling) plus any shared-screen frames.
  live?(jar: Jar, after: number): Promise<unknown>;
  // Optional binary frame proxy: fetch one site-CDN image with the jar (the app can't
  // reach the CDN itself — it only holds a scoped token, never the cookie).
  fetchFrame?(jar: Jar, url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  // Optional write primitive (the edit-on-behalf surface). Symmetric with fetchItem.
  // Gated at the handler by owner OR a structured cap (e.g. write:event:<id>); plugins
  // that don't expose writes leave this undefined.
  editItem?(jar: Jar, id: string, patch: unknown): Promise<unknown>;

  // RFC 0007 §2.4: capability statement + sub-capabilities
  capability?: CapabilityStatement; // the plugin-wide (b2) statement
  scopes?: Record<string, { // named narrow attenuations (b1)
    statement: CapabilityStatement;
    read(jar: Jar): Promise<unknown>;
  }>;
}

export function cookieHeader(jar: Jar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
