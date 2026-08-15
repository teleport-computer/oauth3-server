// #11 — youtube fetchItem: real per-video metadata from the watch page.
// Verified against a LOCAL 127.0.0.1 mock serving pages shaped exactly like YouTube's
// (the fixture below is trimmed from a real /watch?v=jNQXAC9IVRw response, escapes and
// nested braces intact, so the brace-scanner is exercised against genuine markup — not
// a simplified stand-in). Live-YouTube behavior is separately proven on staging in the
// PR's Tier 1 transcript; these tests pin the contract: real data for a real id, a
// THROW (not a shaped-but-empty object) for an unresolvable one, and no marker → throw.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { configureYoutube, extractPlayerResponse, youtubePlugin } from "./youtube.ts";

// Trimmed-but-faithful: `var ytInitialPlayerResponse =` assignment inside a <script>,
// with string values carrying \n, \u201c, URLs, and nested objects/thumbnails.
const ZOO_DETAILS = {
  videoId: "jNQXAC9IVRw",
  title: "Me at the zoo",
  lengthSeconds: "19",
  channelId: "UC4QobU6STFB0P71PMvOGN5A",
  shortDescription:
    'Microplastics are accumulating in human brains at an alarming rate\nhttps://www.youtube.com/watch?v=0PT5c1z3LL8\n\n\u201cNanoplastics and Human Health\u201d',
  viewCount: "404886875",
  author: "jawed",
  isLiveContent: false,
};
const okPage = (details: unknown) =>
  `<html><head><meta charset="utf-8"></head><body><script>var ytInitialPlayerResponse = ${
    JSON.stringify({
      playabilityStatus: { status: "OK", playableInEmbed: true },
      videoDetails: details,
    })
  };</script><script>var ytInitialData = {};</script></body></html>`;

const bogusPage =
  `<html><body><script>var ytInitialPlayerResponse = ${
    JSON.stringify({
      playabilityStatus: { status: "ERROR", reason: "This video is unavailable" },
    })
  };</script></body></html>`;

const junkPage = "<html><body>some unrelated page</body></html>";

let base = "";
let server: { shutdown(): Promise<void> } | undefined;

// The mock dispatches on the video id — per-call deterministic, 127.0.0.1 only.
function mockYoutube(req: Request): Response {
  const u = new URL(req.url);
  if (u.pathname !== "/watch") return new Response("not found", { status: 404 });
  const id = u.searchParams.get("v") ?? "";
  const page = id === "jNQXAC9IVRw"
    ? okPage(ZOO_DETAILS)
    : id === "BRACES1"
    ? okPage({
      videoId: "BRACES1",
      title: 'He said "ok}" then {left} \\o/ }', // braces + escaped quote INSIDE strings
      author: 'chan}"nel',
      channelId: "UCx",
      lengthSeconds: "61",
      viewCount: "7",
      shortDescription: "}{\"",
    })
    : id === "ZZZZZZZZZZZ"
    ? bogusPage
    : junkPage;
  return new Response(page, { status: 200, headers: { "Content-Type": "text/html" } });
}

Deno.test("youtube fetchItem: start mock server", async () => {
  const ready = Promise.withResolvers<string>();
  server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: (a) => ready.resolve(`http://${a.hostname}:${a.port}`) },
    mockYoutube,
  );
  base = await ready.promise;
  configureYoutube({ YOUTUBE_BASE: base });
});

Deno.test("youtube fetchItem: returns real title/channel for a resolved id", async () => {
  const d = await youtubePlugin.fetchItem({ SAPISID: "x" }, "jNQXAC9IVRw") as Record<string, unknown>;
  assertEquals(d.id, "jNQXAC9IVRw");
  assertEquals(d.title, "Me at the zoo");
  assertEquals(d.channel, "jawed");
  assertEquals(d.channelId, "UC4QobU6STFB0P71PMvOGN5A");
  assertEquals(d.lengthSeconds, "19");
  assertEquals(d.viewCount, "404886875");
  assertEquals(d.url, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
});

Deno.test("youtube fetchItem: braces/escapes inside string values do not break the scan", async () => {
  const d = await youtubePlugin.fetchItem({}, "BRACES1") as Record<string, unknown>;
  assertEquals(d.title, 'He said "ok}" then {left} \\o/ }');
  assertEquals(d.channel, 'chan}"nel');
});

Deno.test("youtube fetchItem: unresolvable id THROWS (never a shaped-but-empty object)", async () => {
  await assertRejects(
    () => youtubePlugin.fetchItem({}, "ZZZZZZZZZZZ"),
    Error,
    "unavailable",
  );
});

Deno.test("youtube fetchItem: page without the player response throws", async () => {
  await assertRejects(
    () => youtubePlugin.fetchItem({}, "NOMARKER"),
    Error,
    "ytInitialPlayerResponse not found",
  );
});

Deno.test("youtube fetchItem: extractPlayerResponse unit — nested + escaped", () => {
  const unit = {
    playabilityStatus: { status: "OK" },
    videoDetails: {
      title: 'a"b}c',
      thumbnail: { thumbnails: [{ url: "https://x/?a={b}" }] },
    },
  };
  const pr = extractPlayerResponse(
    `<script>var ytInitialPlayerResponse = ${JSON.stringify(unit)};</script>`,
  );
  assert(pr);
  assertEquals(pr.videoDetails.title, 'a"b}c');
  assertEquals(pr.videoDetails.thumbnail.thumbnails[0].url, "https://x/?a={b}");
  assertEquals(extractPlayerResponse(junkPage), null);
});

Deno.test("youtube fetchItem: stop mock server", async () => {
  await server!.shutdown();
  configureYoutube({ YOUTUBE_BASE: "" }); // restore live base for any later test
});
