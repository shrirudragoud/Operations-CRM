import { describe, expect, it, vi } from "vitest";
import { GENERIC_ERROR, PERMISSION_ERROR, dbErrorMessage, fail } from "./errors";

describe("dbErrorMessage", () => {
  it("shows business-rule messages verbatim", () => {
    expect(dbErrorMessage({ code: "P0001", message: "Only the founder can mark a deal as won" })).toBe(
      "Only the founder can mark a deal as won",
    );
  });
  it("shows our RPC permission messages but hides raw grant errors", () => {
    expect(dbErrorMessage({ code: "42501", message: "Only the founder can invite people" })).toBe(
      "Only the founder can invite people",
    );
    expect(dbErrorMessage({ code: "42501", message: "permission denied for function assign_review_queue" })).toBe(
      PERMISSION_ERROR,
    );
  });
  it("translates RLS rejections", () => {
    expect(
      dbErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "deal"' }),
    ).toBe(PERMISSION_ERROR);
  });
  it("maps constraint errors to plain language", () => {
    expect(dbErrorMessage({ code: "23505", message: "duplicate key" })).toMatch(/already exists/);
    expect(dbErrorMessage({ code: "23514", message: "violates check constraint" })).toMatch(/not allowed/);
  });
  it("falls back to a generic message and logs the detail", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(fail({ code: "XX000", message: "internal" }, "test")).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
