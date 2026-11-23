// The assistant's tools, grouped by area of the app. A person only gets the tools of areas their role may open,
// and every call is checked again here, so a model that invents a tool name still cannot reach another area.

import type { FunctionDeclaration } from "@/lib/ai/gemini";
import { calendarArea } from "@/lib/ai/areas/calendar";
import { insightsArea } from "@/lib/ai/areas/insights";
import { inventoryArea } from "@/lib/ai/areas/inventory";
import { leaveArea } from "@/lib/ai/areas/leave";
import { dealsArea, institutionsArea, outreachArea } from "@/lib/ai/areas/sales";
import { tasksArea } from "@/lib/ai/areas/tasks";
import { workshopArea } from "@/lib/ai/areas/workshop";
import type { ToolBudget, ToolEnv, ToolResult } from "@/lib/ai/tools";
import type { Me } from "@/lib/permissions";

export type AreaModule = {
  id: string;
  allowed: (me: Me) => boolean;
  declarations: FunctionDeclaration[];
  /** Tools that draft a change, with who may be offered each. A tool not listed here is a read and needs only the area. */
  writes?: Record<string, (me: Me) => boolean>;
  run: (env: ToolEnv, name: string, args: unknown, budget: ToolBudget) => Promise<ToolResult>;
  /** A heading line followed by '-' lines, added to the system prompt only when the area is enabled. */
  prompt: string[];
};

export const AREAS: AreaModule[] = [tasksArea, calendarArea, workshopArea, institutionsArea, dealsArea, outreachArea, leaveArea, inventoryArea, insightsArea];

const BLOCKED = "That is not something this person's role may do.";

export const enabledAreas = (me: Me, areas: AreaModule[] = AREAS): AreaModule[] => areas.filter((a) => a.allowed(me));

const offered = (a: AreaModule, me: Me, tool: string): boolean => a.writes?.[tool]?.(me) ?? true;

export const toolsFor = (me: Me, areas: AreaModule[] = AREAS): FunctionDeclaration[] =>
  enabledAreas(me, areas).flatMap((a) => a.declarations.filter((d) => offered(a, me, d.name)));

export const knownTool = (name: string, areas: AreaModule[] = AREAS): boolean => areas.some((a) => a.declarations.some((d) => d.name === name));

export async function runTool(env: ToolEnv, name: string, args: unknown, budget: ToolBudget, areas: AreaModule[] = AREAS): Promise<ToolResult> {
  const owner = areas.find((a) => a.declarations.some((d) => d.name === name));
  if (!owner) return { error: `There is no tool called ${name}.` };
  if (!owner.allowed(env.me) || !offered(owner, env.me, name)) return { error: BLOCKED };
  return owner.run(env, name, args, budget);
}
