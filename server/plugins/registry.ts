import { Plugin } from "./types.ts";
import { otterPlugin } from "./otter.ts";
import { youtubePlugin } from "./youtube.ts";
import { redditPlugin } from "./reddit.ts";
import { nytimesPlugin } from "./nytimes.ts";
import { twitterPlugin } from "./twitter.ts";
import { googleCalendarPlugin } from "./google-calendar.ts";
import { amazonPlugin } from "./amazon.ts";
import { zaiPlugin } from "./zai.ts";

const plugins = new Map<string, Plugin>();
for (const p of [otterPlugin, youtubePlugin, redditPlugin, nytimesPlugin, twitterPlugin, googleCalendarPlugin, amazonPlugin, zaiPlugin]) plugins.set(p.id, p);

export function getPlugin(id: string): Plugin | undefined { return plugins.get(id); }
export function allPlugins(): Plugin[] { return [...plugins.values()]; }
