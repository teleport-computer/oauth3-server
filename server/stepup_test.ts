import { assertEquals } from "jsr:@std/assert";
import { approveChallenge, createChallenge, score } from "./stepup.ts";

// Regression: an APPROVED challenge must let the token's next read through. Before the fix,
// approveChallenge left first-use set, so score() re-challenged forever.
Deno.test("stepup: approving a challenge clears first-use so the next read is approved", () => {
  const tok = "tok-amazon-deadbeefcafef00d";
  // first use → challenge
  assertEquals(score(tok, "amazon", "items").decision, "challenge");
  const chal = createChallenge("amazon", "items", tok, "cart-share", "first_token_use");
  // owner approves
  approveChallenge(chal.challengeId, "owner", true);
  // next read now scores approve (not another challenge)
  assertEquals(score(tok, "amazon", "items").decision, "approve");
});

Deno.test("stepup: a denied/absent approval leaves the token challenging", () => {
  const tok = "tok-amazon-11112222333344445555";
  assertEquals(score(tok, "amazon", "items").decision, "challenge");
  // no approval → still first use
  assertEquals(score(tok, "amazon", "items").decision, "challenge");
});
