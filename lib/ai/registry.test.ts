import { describe, expect, it } from "vitest";
import { fakeEnv, ME } from "./fake-env";
import { AREAS, enabledAreas, knownTool, runTool, toolsFor, type AreaModule } from "./registry";
import { MAX_DRAFTS_PER_MESSAGE } from "./tools";

const budget = () => ({ drafts: MAX_DRAFTS_PER_MESSAGE });
const partner = { ...ME, role: "partner" as const };

const secret: AreaModule = {
  id: "secret",
  allowed: (me) => me.role === "founder",
  declarations: [{ name: "secret_lookup", description: "x", parameters: { type: "object", properties: {} } }],
  run: async () => ({ ok: true }),
  prompt: ["Secret", "- Be quiet."],
};
const areas = [...AREAS, secret];

describe("registry", () => {
  it("lists only the tools of areas the person's role may use", () => {
    expect(toolsFor(ME, areas).some((d) => d.name === "secret_lookup")).toBe(true);
    expect(toolsFor(partner, areas).some((d) => d.name === "secret_lookup")).toBe(false);
    expect(enabledAreas(partner, areas).map((a) => a.id)).not.toContain("secret");
  });

  it("refuses a gated tool even when the model names it anyway", async () => {
    const { env } = fakeEnv({ me: partner });
    expect(await runTool(env, "secret_lookup", {}, budget(), areas)).toEqual({ error: "That is not something this person's role may do." });
    const { env: founder } = fakeEnv();
    expect(await runTool(founder, "secret_lookup", {}, budget(), areas)).toEqual({ ok: true });
  });

  it("says plainly when a tool does not exist", async () => {
    const { env } = fakeEnv();
    expect(await runTool(env, "drop_database", {}, budget(), areas)).toEqual({ error: "There is no tool called drop_database." });
    expect(knownTool("my_day")).toBe(true);
    expect(knownTool("drop_database")).toBe(false);
  });

  it("has unique tool names across all areas", () => {
    const names = AREAS.flatMap((a) => a.declarations.map((d) => d.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
