import "server-only";
import { baseUrl, call, GeminiError } from "@/lib/ai/gemini";
import { LIVE_SOCKET_PATH } from "@/lib/ai/live";

// The server's half of a voice session: find a live model the person's key can use, and hand the browser a
// short-lived token so the key itself never leaves the server.

const SESSION_MINUTES = 30;
const START_WINDOW_SECONDS = 120;

export async function listLiveModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `${baseUrl()}/v1beta/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const json = (await call(url, { headers: { "x-goog-api-key": apiKey } }, 20_000, signal)) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if ((m.supportedGenerationMethods ?? []).includes("bidiGenerateContent") && /^[A-Za-z0-9._-]{1,80}$/.test(id)) out.push(id);
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

/** A one-use token for the browser's WebSocket. It works only with the Live API and stops working after the session window. */
export async function mintLiveToken(apiKey: string, signal?: AbortSignal): Promise<{ token: string; expiresAt: string }> {
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_MINUTES * 60_000).toISOString();
  const json = (await call(
    `${baseUrl()}/v1beta/auth_tokens`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ uses: 1, expireTime: expiresAt, newSessionExpireTime: new Date(now + START_WINDOW_SECONDS * 1000).toISOString() }),
    },
    20_000,
    signal,
  )) as { name?: string };
  if (!json.name) throw new GeminiError("unavailable");
  return { token: json.name, expiresAt };
}

export function liveSocketUrl(token: string): string {
  return `${baseUrl().replace(/^http/, "ws")}${LIVE_SOCKET_PATH}?access_token=${encodeURIComponent(token)}`;
}
