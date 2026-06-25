// Browser SPI client. For tasks where a rendered, logged-in view is the only option
// (no reifiable API), hand the SAME vault jar a plugin already holds to an external
// browser-in-TEE (login-with-anything/tee-browser) and get a screenshot back. The
// browser is just another consumer of the jar — it never logs in, never sees a
// password; the jar arrives sealed from the plugin/CLI sync like every other read.

import { Jar, Plugin } from "./plugins/types.ts";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// The vault stores name->value only, so domain/secure are reconstructed from the
// plugin's cookieDomains. sameSite must be a chrome.cookies.set enum, not "None".
function jarToCookies(plugin: Plugin, jar: Jar) {
  const domain = plugin.cookieDomains[0];
  return Object.entries(jar).map(([name, value]) => ({
    name, value, domain, path: "/", secure: true, httpOnly: false, sameSite: "no_restriction",
  }));
}

async function spi(spiUrl: string, path: string, body: unknown): Promise<any> {
  const r = await fetch(`${spiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`browser SPI ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function browserScreenshot(spiUrl: string, plugin: Plugin, jar: Jar, targetUrl: string) {
  if (!spiUrl) throw new Error("BROWSER_SPI_URL not configured — no browser SPI to drive");
  await spi(spiUrl, "/session", { cookies: jarToCookies(plugin, jar), userAgent: UA });
  await spi(spiUrl, "/navigate", { url: targetUrl });
  await new Promise((res) => setTimeout(res, 5000)); // let logged-in XHR settle
  const t = await spi(spiUrl, "/capture-trace", {});
  return { screenshot: t.screenshot, title: t.title, dom_chars: (t.dom_html || "").length };
}
