import http from "node:http";

// A stand-in for the Gemini REST API so the assistant can be tested end to end without a real key or network.
// It answers by looking at the last message, the way a model would: ask for a lookup, then answer from the result.

export const STUB_PORT = Number(process.env.E2E_GEMINI_PORT ?? 3191);
export const STUB_KEY = "AIzaSyE2EFAKEFAKEFAKEFAKEFAKEFAKE12345";

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
type Content = { role: string; parts: Part[] };
export type StubRequest = { url: string; key: string | undefined; model?: string; system?: string; contents?: Content[] };

const turn = (parts: Part[]) => ({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const say = (text: string) => turn([{ text }]);
const call = (name: string, args: Record<string, unknown>) => turn([{ functionCall: { name, args } }]);

function answer(system: string, contents: Content[]) {
  const last = contents[contents.length - 1]!;
  const reply = last.parts.find((p) => p.functionResponse)?.functionResponse;
  const ask = [...contents].reverse().find((c) => c.role === "user" && c.parts.some((p) => p.text))?.parts.find((p) => p.text)?.text ?? "";

  if (reply) {
    if (reply.name === "search_tasks") return say("Nothing is late right now.");
    if (reply.name === "find_people") {
      const me = (reply.response.matches as { id: string; is_the_person_you_are_talking_to: boolean }[] | undefined)?.find((m) => m.is_the_person_you_are_talking_to);
      const title = /create task: (.+)$/i.exec(ask)?.[1] ?? "ZZ Bot task";
      return call("propose_create_task", { title, assignee_id: me?.id, due_date: "2099-01-15" });
    }
    if (reply.name === "propose_create_task") return say("The draft is ready for you to confirm.");
    if (reply.name === "whats_on") return say(reply.response.error ? "I could not look that up." : `Looked at the calendar: ${(reply.response as { total?: number }).total ?? 0} items.`);
    if (reply.name === "search_deals" || reply.name === "pipeline_summary") return say(reply.response.error ? "I could not look that up." : "Checked the pipeline.");
    return say("Done looking.");
  }
  if (/who is late/i.test(ask)) return call("search_tasks", { overdue: true });
  const on = /what is on (\d{4}-\d{2}-\d{2})/i.exec(ask)?.[1];
  if (on) return call("whats_on", { from: on });
  if (/open deals/i.test(ask)) return call("search_deals", {});
  if (/create task:/i.test(ask)) return call("find_people", { query: "Local" });
  if (/explain this task/i.test(ask)) return say(system.includes("They have this task open right now") ? "I can see the open task." : "No task is open.");
  return say("Okay.");
}

/** Starts the stub. `mode.fail` makes every answer a 429 daily-quota error, to test the failure path. */
export function startGeminiStub(port = STUB_PORT, key = STUB_KEY) {
  const log: StubRequest[] = [];
  const mode = { fail: false };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const header = req.headers["x-goog-api-key"];
      const given = Array.isArray(header) ? header[0] : header;
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = req.url ?? "";
      if (given !== key) return send(400, { error: { message: "API key not valid. Please pass a valid API key." } });
      if (req.method === "GET" && url.startsWith("/v1beta/models")) {
        log.push({ url, key: given });
        const model = (name: string) => ({ name: `models/${name}`, displayName: name, supportedGenerationMethods: ["generateContent"] });
        const live = { name: "models/gemini-3.8-live", displayName: "live", supportedGenerationMethods: ["bidiGenerateContent"] };
        return send(200, { models: [model("gemini-2.5-flash"), model("gemini-2.5-pro"), live] });
      }
      if (req.method === "POST" && url === "/v1beta/auth_tokens") {
        log.push({ url, key: given });
        return send(200, { name: "auth_tokens/e2e-token" });
      }
      const m = /^\/v1beta\/models\/([^:]+):generateContent$/.exec(url);
      if (req.method === "POST" && m) {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { systemInstruction?: { parts: { text: string }[] }; contents: Content[] };
        const system = body.systemInstruction?.parts.map((p) => p.text).join("") ?? "";
        log.push({ url, key: given, model: m[1], system, contents: body.contents });
        if (mode.fail) return send(429, { error: { message: "Quota exceeded for metric per day" } });
        return send(200, answer(system, body.contents));
      }
      send(404, { error: { message: "not found" } });
    });
  });
  return {
    log,
    mode,
    listen: () => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
