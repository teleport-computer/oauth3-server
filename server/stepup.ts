// Runtime step-up authorization gate (RFC 0005 P0).
// A third auth layer at invocation time: anomalous reads trip a guard that
// pauses and asks the user to confirm out-of-band. App sees "challenge pending"
// and retries. The approval happens on a channel the app has no token for.

import { audit } from "./audit.ts";

export interface Challenge {
  challengeId: string;
  plugin: string;
  item: string; // "list" or item id
  token: string; // the token being challenged (stripped)
  app?: string; // app attribution from token
  signal: string; // what tripped the guard
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
  expiresAt: number;
}

// In-memory challenge store (local-jar only; no persistence in P0)
const challenges = new Map<string, Challenge>();

// Token usage tracking for the "first use" signal (in-memory for P0)
const tokenFirstUse = new Map<string, boolean>();

// TTL: challenge expires after 5 minutes
const CHALLENGE_TTL = 5 * 60 * 1000;

function generateId(): string {
  return `chal-${crypto.randomUUID().replace(/-/g, "")}`;
}

// Score the invocation and return a decision.
// Returns: { decision: "approve" | "reject" | "challenge", signal?: string }
export function score(
  tokenStr: string, // the full token
  plugin: string,
  item: string,
  app?: string
): { decision: "approve" | "reject" | "challenge"; signal?: string } {
  // P0: ONE signal — first use of a token
  const tokenKey = `${plugin}-${tokenStr.slice(0, 16)}`;
  const isFirstUse = !tokenFirstUse.has(tokenKey);

  if (isFirstUse) {
    return { decision: "challenge", signal: "first_token_use" };
  }

  // Otherwise auto-approve
  return { decision: "approve" };
}

// Create a pending challenge. Call this when score returns "challenge".
export function createChallenge(
  plugin: string,
  item: string,
  tokenStr: string,
  app: string | undefined,
  signal: string
): Challenge {
  const challengeId = generateId();
  const now = Date.now();
  const chal: Challenge = {
    challengeId,
    plugin,
    item,
    token: tokenStr.slice(0, 16), // store stripped prefix only
    app,
    signal,
    status: "pending",
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL,
  };
  challenges.set(challengeId, chal);
  return chal;
}

// Get a challenge by id. Returns null if not found or expired.
export function getChallenge(id: string): Challenge | null {
  const chal = challenges.get(id);
  if (!chal) return null;
  // Auto-expire
  if (Date.now() > chal.expiresAt && chal.status === "pending") {
    chal.status = "expired";
    audit("stepup.expired", { challengeId: id, plugin: chal.plugin, signal: chal.signal });
  }
  return chal;
}

// Record that a token has been used (called after successful read)
export function recordTokenUse(tokenStr: string, plugin: string): void {
  const tokenKey = `${plugin}-${tokenStr.slice(0, 16)}`;
  tokenFirstUse.set(tokenKey, true);
}

// Approve a challenge. Returns the challenge if found and pending, else null.
// The approver is the session subject (must not be the app itself).
export function approveChallenge(id: string, approver: string, approverIsOwner: boolean): Challenge | null {
  const chal = challenges.get(id);
  if (!chal || chal.status !== "pending") return null;

  // App bearer must not self-approve
  // Check if the approver's session matches the app attribution
  // This is enforced at the handler level (subjectOf checks); here we just record
  chal.status = "approved";
  audit("stepup.approved", {
    challengeId: id,
    plugin: chal.plugin,
    item: chal.item,
    app: chal.app,
    approver,
    approverIsOwner,
    signal: chal.signal,
  });
  return chal;
}

// Deny a challenge. Returns the challenge if found and pending, else null.
export function denyChallenge(id: string, approver: string, approverIsOwner: boolean): Challenge | null {
  const chal = challenges.get(id);
  if (!chal || chal.status !== "pending") return null;

  chal.status = "denied";
  audit("stepup.denied", {
    challengeId: id,
    plugin: chal.plugin,
    item: chal.item,
    app: chal.app,
    approver,
    approverIsOwner,
    signal: chal.signal,
  });
  return chal;
}

// Check if a token was the first use (for idempotency)
export function wasFirstUse(tokenStr: string, plugin: string): boolean {
  const tokenKey = `${plugin}-${tokenStr.slice(0, 16)}`;
  return !tokenFirstUse.has(tokenKey);
}
