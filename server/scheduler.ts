// Always-on poller. Every POLL_INTERVAL_MIN, for each plugin with a synced jar,
// list items and fetch any not yet stored under <dataDir>/transcripts/<plugin>/.
// This is the "frozen" path — no browser; it just replays the synced cookie against
// the site's unofficial API. Started once (warmup or first request); the loop lives
// in the long-lived runtime process.
//
// Errors propagate to the tick handler, which logs and lets the next interval retry.
// The loop itself stays alive so one bad fetch (or an expired jar) doesn't stop sync.

import { getPlugin } from "./plugins/registry.ts";
import { allJars } from "./vault.ts";

let started = false;

export function startScheduler(env: Record<string, string>, dataDir: string): void {
  if (started || !dataDir) return;
  started = true;
  const everyMin = Number(env.POLL_INTERVAL_MIN) || 30;
  const tick = () => syncAll(dataDir).catch((e) => console.error("[sched] tick failed:", (e as Error).message));
  tick();
  setInterval(tick, everyMin * 60_000);
  console.log(`[sched] polling every ${everyMin}m → ${dataDir}/transcripts`);
}

async function syncAll(dataDir: string): Promise<void> {
  for (const { subject, plugin: pid, account, jar } of allJars()) {
    const p = getPlugin(pid);
    if (!p || !p.loggedIn(jar)) continue;
    const dir = `${dataDir}/transcripts/${subject}/${pid}/${account}`;
    await Deno.mkdir(dir, { recursive: true });
    const items = await p.listItems(jar);
    let added = 0;
    for (const it of items) {
      const f = `${dir}/${it.id}.json`;
      if (await exists(f)) continue;
      const data = await p.fetchItem(jar, it.id);
      await Deno.writeTextFile(f, JSON.stringify({ item: it, data, syncedAt: Date.now() }));
      added++;
    }
    if (added) console.log(`[sched] ${subject}/${pid}: +${added} new (${items.length} total)`);
  }
}

async function exists(f: string): Promise<boolean> {
  try {
    await Deno.stat(f);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
