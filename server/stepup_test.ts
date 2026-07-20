import { assert, assertEquals } from "jsr:@std/assert";
import { approveChallenge, createChallenge, score } from "./stepup.ts";
import handler from "./handler.ts";
import { mint } from "./tokens.ts";
import { createSession } from "./sessions.ts";

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

// The gate's only signal is first use, which is true of EVERY token — so it challenged 100% of
// reads, including the read that IS the grant the user just consented to. Consent seconds old is
// still live; a token that sat idle is the case worth stopping.
Deno.test("stepup: fresh consent passes, cold consent still challenges", () => {
  assertEquals(
    score("tok-zai-freshconsent0001", "zai", "quota", "zai-usage", Date.now()).decision,
    "approve",
  );
  assertEquals(
    score("tok-zai-coldconsent0002", "zai", "quota", "zai-usage", Date.now() - 10 * 60 * 1000).decision,
    "challenge",
  );
  // an unknown mint time is treated as cold — no silent pass
  assertEquals(score("tok-zai-nomint0003", "zai", "quota", "zai-usage").decision, "challenge");
});

// The wallet's inbox. Before this route the only way to answer a challenge was to already know
// its id — which only the app had — so a challenge raised against the user's token was
// unanswerable by the user, and every gated read dead-ended at "waiting for approval".
Deno.test("handler GET /api/challenges/pending — the subject's own challenges, and only those", async () => {
  const ctx = { env: { OWNER_SECRET: "test-owner-secret-chal" }, dataDir: "" };
  const mine = await mint("zai", "u-alice", "zai-usage", ["zai:usage-read"]);
  const theirs = await mint("zai", "u-bob", "zai-usage", ["zai:usage-read"]);
  const cMine = createChallenge("zai", "quota", mine.token, "zai-usage", "first_token_use");
  const cTheirs = createChallenge("zai", "quota", theirs.token, "zai-usage", "first_token_use");
  const sess = await createSession("u-alice");

  const get = (bearer: string) =>
    handler(new Request("http://localhost/api/challenges/pending", {
      headers: { Authorization: `Bearer ${bearer}` },
    }), ctx);

  assertEquals((await handler(new Request("http://localhost/api/challenges/pending"), ctx)).status, 401);

  const ids = ((await (await get(sess)).json()).challenges as Array<{ challengeId: string }>)
    .map((c) => c.challengeId);
  assert(ids.includes(cMine.challengeId), "alice sees the challenge on her own token");
  assert(!ids.includes(cTheirs.challengeId), "alice must NOT see a challenge on bob's token");
});
