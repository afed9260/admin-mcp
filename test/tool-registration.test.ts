import { describe, expect, it } from "vitest";
import { readonlyToolNames } from "../src/tools/register-tools.js";

describe("readonlyToolNames", () => {
  it("does not expose write tools", () => {
    expect(readonlyToolNames).toEqual([
      "get_funnel_stats",
      "get_cost_stats",
      "list_dialogs",
      "get_dialog",
      "get_bot_funnel_stats",
      "list_nudge_rules",
      "get_nudge_rule_candidates",
      "get_nudge_history",
    ]);

    expect(readonlyToolNames.join(" ")).not.toMatch(/create|update|delete|toggle|send|broadcast/i);
  });
});
