import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/utils/supabase/proxy";

describe("isPublicPath", () => {
  it("lets the sign-in pages and the health check through", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
  });
  it("keeps everything else behind sign-in", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/attendance")).toBe(false);
    expect(isPublicPath("/api/health/secret")).toBe(false);
  });
});
