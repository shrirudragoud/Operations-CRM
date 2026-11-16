import { describe, expect, it } from "vitest";
import { redirectTo } from "@/lib/redirect";

describe("redirectTo", () => {
  it("sends a relative Location so the public host is never replaced by the bind address", () => {
    const res = redirectTo("/login?error=claim_failed");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login?error=claim_failed");
  });
  it("honours the status", () => {
    expect(redirectTo("/login", 303).status).toBe(303);
  });
  it("refuses anything that is not a same-site path", () => {
    expect(() => redirectTo("https://evil.example")).toThrow();
    expect(() => redirectTo("//evil.example")).toThrow();
  });
});
