// Optional outbound egress proxy. When the daemon injects EGRESS_PROXY_URL
// (a socks5:// to the shared VPN), plugins route site fetches through it so the
// request exits from a residential/VPN IP instead of the datacenter — sites like
// YouTube silently de-auth valid sessions replayed from datacenter IPs.
let client: Deno.HttpClient | null = null;
let proxyUrl = "";

export function configureEgress(url: string): void {
  if (url === proxyUrl) return;
  try { client?.close(); } catch { /* already closed */ }
  proxyUrl = url;
  client = url ? Deno.createHttpClient({ proxy: { url } }) : null;
  console.log(`[egress] ${url ? "routing outbound via " + url : "direct (no proxy)"}`);
}

export function egressProxy(): string { return proxyUrl; }

// Drop-in fetch that routes through the egress proxy when configured, else direct.
export function egressFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  return fetch(input, client ? { ...init, client } as RequestInit : init);
}
