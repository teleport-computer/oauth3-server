// App-authorization handshake (auth layer 2 — the per-user grant). An app calls
// POST /api/connect to ask for access to a plugin; the user lands on the approve
// page, grants, and a scoped token is minted and handed back to the app via its
// requestId. The app never holds the owner secret.

import { mint } from "./tokens.ts";

export interface ConnectReq {
  requestId: string;
  plugin: string;
  subject?: string;
  app?: string;
  status: "pending" | "approved" | "denied";
  token?: string;
  createdAt: number;
}

let file = "";
let reqs: Record<string, ConnectReq> = {};

async function persist(): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(reqs));
}

export async function initConnect(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/connect.json`;
  try { reqs = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export async function createConnect(plugin: string, subject?: string, app?: string): Promise<ConnectReq> {
  const requestId = `req-${crypto.randomUUID().replace(/-/g, "")}`;
  reqs[requestId] = { requestId, plugin, subject, app, status: "pending", createdAt: Date.now() };
  await persist();
  return reqs[requestId];
}

export function getConnect(id: string): ConnectReq | undefined { return reqs[id]; }

// The token is bound to the APPROVER's identity (whose jar it will read), not the
// app-supplied attribution. r.subject stays as the app's display hint.
export async function approveConnect(id: string, approver: string): Promise<ConnectReq | null> {
  const r = reqs[id];
  if (!r || r.status !== "pending") return null;
  const t = await mint(r.plugin, approver, r.app);
  r.status = "approved";
  r.token = t.token;
  await persist();
  return r;
}

export async function denyConnect(id: string): Promise<ConnectReq | null> {
  const r = reqs[id];
  if (!r) return null;
  if (r.status === "pending") { r.status = "denied"; await persist(); }
  return r;
}

// What the polling app sees — token only once approved.
export function statusOf(r: ConnectReq): { status: string; token?: string } {
  return r.status === "approved" ? { status: "approved", token: r.token } : { status: r.status };
}
