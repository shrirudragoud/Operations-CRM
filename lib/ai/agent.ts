import { callsOf, generate, GeminiError, textOf, type Content, type FunctionDeclaration, type Generated, type GenerateInput, type Part } from "@/lib/ai/gemini";
import { systemPrompt } from "@/lib/ai/prompt";
import { runTool, toolsFor } from "@/lib/ai/registry";
import { MAX_DRAFTS_PER_MESSAGE, type ToolBudget, type ToolEnv, type ToolResult } from "@/lib/ai/tools";

// One assistant turn: send the chat to Gemini, run the lookups it asks for, and stop at a plain answer.
// Bounded on every side: rounds, calls per round, result size, history size, drafts per message.

export const MAX_ROUNDS = 8;
export const MAX_CALLS_PER_ROUND = 8;
export const MAX_RESULT_CHARS = 8000;
export const MAX_HISTORY_TURNS = 14;
export const MAX_HISTORY_CHARS = 150_000;
export const MAX_USER_CHARS = 4000;

export type StoredContent = { parts: Part[]; drafts?: string[]; error?: boolean };
export type StoredMessage = { role: "user" | "model" | "tool"; content: StoredContent };

export type AgentInput = {
  apiKey: string;
  model: string;
  env: ToolEnv;
  history: StoredMessage[];
  userText: string;
  current?: { id: string; title: string } | null;
  signal?: AbortSignal;
  gen?: (input: GenerateInput) => Promise<Generated>;
  tools?: FunctionDeclaration[];
};

export type AgentResult = { produced: StoredMessage[]; reply: string; draftIds: string[]; usage: { prompt: number; output: number }; rounds: number };

/** Thrown when Gemini fails mid-turn. `produced` ends with a short model message so the saved chat stays well formed. */
export class AgentFailure extends Error {
  constructor(public cause: GeminiError, public produced: StoredMessage[], public draftIds: string[]) {
    super(cause.message);
  }
}

export function toContents(rows: StoredMessage[]): Content[] {
  return rows.map((r) => ({ role: r.role === "model" ? "model" : "user", parts: r.content.parts }));
}

const isUserText = (r: StoredMessage) => r.role === "user";
const size = (r: StoredMessage) => JSON.stringify(r.content).length;

/** Keep the last few user turns whole (with the tool calls that followed them), and stay under a size cap. */
export function trimHistory(rows: StoredMessage[], maxTurns = MAX_HISTORY_TURNS, maxChars = MAX_HISTORY_CHARS): StoredMessage[] {
  const starts = rows.flatMap((r, i) => (isUserText(r) ? [i] : []));
  if (starts.length === 0) return [];
  let from = starts[Math.max(0, starts.length - maxTurns)]!;
  let rest = starts.filter((s) => s > from);
  const total = (f: number) => rows.slice(f).reduce((n, r) => n + size(r), 0);
  while (total(from) > maxChars && rest.length > 0) {
    from = rest[0]!;
    rest = rest.slice(1);
  }
  return rows.slice(from);
}

export function capResult(result: ToolResult, max = MAX_RESULT_CHARS): ToolResult {
  const json = JSON.stringify(result);
  if (json.length <= max) return result;
  return { error: "That result was too large and was cut off. Narrow the search (a person, a status, a department or dates) and try again.", partial: json.slice(0, max) };
}

const FALLBACK = "I could not put an answer together for that. Try asking in a different way.";
const OUT_OF_STEPS = "That took more steps than I am allowed in one go. Here is where I got to; ask me to carry on and I will.";

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const gen = input.gen ?? generate;
  const tools = input.tools ?? toolsFor(input.env.me);
  const system = systemPrompt({ me: input.env.me, today: input.env.today, current: input.current });
  const userText = input.userText.trim().slice(0, MAX_USER_CHARS);

  const produced: StoredMessage[] = [{ role: "user", content: { parts: [{ text: userText }] } }];
  const contents: Content[] = [...toContents(trimHistory(input.history)), ...toContents(produced)];
  const budget: ToolBudget = { drafts: MAX_DRAFTS_PER_MESSAGE };
  const draftIds: string[] = [];
  const usage = { prompt: 0, output: 0 };

  const ask = async (withTools: boolean): Promise<Generated> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await gen({ apiKey: input.apiKey, model: input.model, system, contents: [...contents], tools: withTools ? tools : undefined, signal: input.signal });
        usage.prompt += out.usage.prompt;
        usage.output += out.usage.output;
        if (callsOf(out.content).length === 0 && textOf(out.content) === "" && attempt < 2) continue;
        return out;
      } catch (e) {
        lastError = e;
        if (!(e instanceof GeminiError) || e.kind !== "malformed" || attempt === 2) throw e;
      }
    }
    throw lastError;
  };

  const finish = (text: string, error = false): AgentResult => {
    const reply = text.trim() || FALLBACK;
    produced.push({ role: "model", content: { parts: [{ text: reply }], ...(draftIds.length ? { drafts: [...draftIds] } : {}), ...(error ? { error: true } : {}) } });
    return { produced, reply, draftIds, usage, rounds };
  };

  let rounds = 0;
  try {
    for (; rounds < MAX_ROUNDS; rounds++) {
      const out = await ask(true);
      const calls = callsOf(out.content);
      if (calls.length === 0) {
        const text = textOf(out.content);
        produced.push({ role: "model", content: { parts: out.content.parts, ...(draftIds.length ? { drafts: [...draftIds] } : {}) } });
        return { produced, reply: text || FALLBACK, draftIds, usage, rounds: rounds + 1 };
      }

      produced.push({ role: "model", content: { parts: out.content.parts } });
      contents.push(out.content);
      const responses: Part[] = [];
      for (const [i, call] of calls.entries()) {
        const result =
          i >= MAX_CALLS_PER_ROUND
            ? { error: `Too many lookups at once. Ask for fewer than ${MAX_CALLS_PER_ROUND} at a time.` }
            : capResult(await runTool(input.env, call.name, call.args, budget));
        if (typeof result.draft_id === "string" && !draftIds.includes(result.draft_id)) draftIds.push(result.draft_id);
        responses.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: result } });
      }
      produced.push({ role: "tool", content: { parts: responses } });
      contents.push({ role: "user", parts: responses });
    }

    rounds = MAX_ROUNDS;
    const last = await ask(false);
    return finish(textOf(last.content) || OUT_OF_STEPS);
  } catch (e) {
    if (e instanceof GeminiError) {
      finish(`I could not finish that: ${e.message}`, true);
      throw new AgentFailure(e, produced, draftIds);
    }
    throw e;
  }
}
