import { describe, expect, it } from "vitest";

import { resolveRiotApiKey } from "../../server/index.js";

describe("resolveRiotApiKey", () => {
  it("prefers NEXUS_API_KEY when present", () => {
    expect(
      resolveRiotApiKey({
        NEXUS_API_KEY: " nexus-key ",
        RIOT_API_KEY: "riot-key"
      })
    ).toBe("nexus-key");
  });

  it("falls back to RIOT_API_KEY when NEXUS_API_KEY is absent", () => {
    expect(
      resolveRiotApiKey({
        RIOT_API_KEY: " riot-key "
      })
    ).toBe("riot-key");
  });

  it("returns an empty string when no supported key env var is set", () => {
    expect(resolveRiotApiKey({})).toBe("");
  });
});
