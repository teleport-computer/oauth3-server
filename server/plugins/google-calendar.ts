// Google Calendar plugin — delegated access to the signed-in account's calendar.
// We hold the whole google.com session jar (synced by the extension); reads are
// gated by a scoped token, and a structured write cap ("write:event:<eventId>")
// lets an app EDIT one specific event on the account's behalf — the point of #69.
//
// The Google account session cookies live on .google.com (SID/HSID/SSID/APISID/
// SAPISID, plus the __Secure-1PSID family for newer accounts); calendar.google.com
// is served by that same account session, so cookieDomains covers both.
//
// DATA PATH — honest stub, not an assumption (issue #69 "investigate, do NOT assume").
// Unlike Otter (whose /speeches endpoint was verified live and baked in) or the
// twitter plugin (a BROWSER-PATH plugin whose listItems throws by design), the exact
// calendar.google.com session endpoints for (a) listing upcoming events and (b)
// editing one event have NOT yet been captured against the cube@shaperotator.xyz
// account on this branch. Per the scope-down rule we ship everything AROUND the data
// path — the plugin shape, loggedIn(), the write cap, the gated+audited endpoint,
// the consent screen — and these methods throw a clear, actionable error rather than
// guessing a fragile internal URL. Establishing the path is operator-run: sync the
// jar, drive the logged-in calendar.google.com via the envoy bridge, capture the
// network_log (the RFC 0001 reification), then bake the verified endpoints here.
// Errors propagate — no fallbacks, no masking.

import { Jar, Plugin, PluginItem } from "./types.ts";

const NOT_CAPTURED = (op: string) =>
  `google-calendar ${op} path not yet captured against the live account — sync the jar and ` +
  `capture the calendar.google.com trajectory (operator-run, issue #69); no assumed endpoint`;

export const googleCalendarPlugin: Plugin = {
  id: "google-calendar",
  label: "Google Calendar",
  cookieDomains: [".google.com", ".calendar.google.com"],
  renderUrl: "https://calendar.google.com/calendar/u/0/r",

  // Presence of the long-lived Google account session cookies. SID + HSID have
  // shipped with every logged-in google.com session for ~two decades and are the
  // reliable "is this an authenticated Google jar" signal (independent of any
  // product-specific cookie). The __Secure-1PSID family is present on newer accounts
  // but not required to call the session authenticated.
  loggedIn(jar: Jar): boolean {
    return !!(jar["SID"] && jar["HSID"]);
  },

  async listItems(_jar: Jar): Promise<PluginItem[]> {
    // Upcoming events (id, title, start) — the session endpoint is captured live, then
    // mapped here. Throwing (not returning []) keeps the read honestly "not live yet".
    throw new Error(NOT_CAPTURED("list"));
  },

  async fetchItem(_jar: Jar, _id: string): Promise<unknown> {
    throw new Error(NOT_CAPTURED("fetch"));
  },

  // Edit-on-behalf: patch one event. Called only after the handler has verified owner OR
  // a write:event:<id> cap, so by the time this runs the caller is authorized for THIS id.
  // The session write endpoint is captured live (operator-run); until then it throws.
  async editItem(_jar: Jar, _id: string, _patch: unknown): Promise<unknown> {
    throw new Error(NOT_CAPTURED("edit"));
  },
};
