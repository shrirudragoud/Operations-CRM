import { describe, expect, it } from "vitest";
import {
  addDays, allDayRange, answerRequestSchema, calQuery, dayPosition, defaultEnd, formatLength, formatTime, isoWeekday, isYmd, itemDays, itemsByDay,
  layoutBanners, overlaps, parseCalParams, rangeTitle, scheduleMeetingSchema, seriesSchema, seriesSummary, stepDate, viewRange, weekDays,
} from "./calendar";

const id = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-12-02T06:00:00Z"); // Wednesday 2 Dec 2026, 11:30 in India

describe("dates", () => {
  it("validates calendar days", () => {
    expect(isYmd("2026-12-31")).toBe(true);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("12/31/2026")).toBe(false);
  });
  it("numbers weekdays like the database", () => {
    expect(isoWeekday("2026-12-07")).toBe(1);
    expect(isoWeekday("2026-12-13")).toBe(7);
  });
  it("lists a Monday-first week", () => {
    expect(weekDays("2026-12-02")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("formats India time", () => {
    expect(formatTime("2026-12-02T04:30:00Z")).toBe("10:00 am");
    expect(formatLength(45)).toBe("45 min");
    expect(formatLength(90)).toBe("1 h 30 min");
    expect(defaultEnd("10:00", 45)).toBe("10:45");
    expect(defaultEnd("23:50", 30)).toBe("23:59");
  });
});

describe("fixed meeting summary", () => {
  it("reads naturally", () => {
    expect(seriesSummary({ frequency: "weekly", weekday: 1, month_day: null, start_time: "10:00:00" })).toBe("Every Monday at 10:00 am");
    expect(seriesSummary({ frequency: "biweekly", weekday: 2, month_day: null, start_time: "16:00" })).toBe("Every other Tuesday at 4:00 pm");
    expect(seriesSummary({ frequency: "monthly", weekday: null, month_day: 22, start_time: "09:30" })).toBe("On the 22nd of every month at 9:30 am");
    expect(seriesSummary({ frequency: "monthly", weekday: null, month_day: 11, start_time: "12:00" })).toBe("On the 11th of every month at 12:00 pm");
  });
});

describe("URL state", () => {
  it("falls back to safe defaults", () => {
    expect(parseCalParams({ scope: "x", view: "y", date: "nope", dept: "zzz", show: "q", who: "nope" }, {}, NOW)).toEqual({ scope: "me", dept: "", view: "month", date: "2026-12-02", show: "all", who: "" });
  });
  it("uses the lead's default scope and accepts a month", () => {
    const p = parseCalParams({ month: "2027-01" }, { scope: "team" }, NOW);
    expect(p.scope).toBe("team");
    expect(p.date).toBe("2027-01-01");
  });
  it("leaves defaults out of the query", () => {
    expect(calQuery({ scope: "me", view: "month", date: "2026-12-02", show: "all" }, {}, NOW)).toBe("");
    expect(calQuery({ scope: "team", dept: "sales", view: "week", date: "2026-12-09", show: "meetings" }, {}, NOW)).toBe("scope=team&dept=sales&view=week&date=2026-12-09&show=meetings");
  });
  it("keeps a person's id only for the person scope", () => {
    const who = "00000000-0000-4000-8000-0000000000AB";
    const p = parseCalParams({ scope: "person", who }, {}, NOW);
    expect(p).toMatchObject({ scope: "person", who: who.toLowerCase() });
    expect(calQuery({ ...p, view: "month", show: "all" }, {}, NOW)).toBe(`scope=person&who=${who.toLowerCase()}`);
    expect(calQuery({ scope: "team", dept: "sales", who: who.toLowerCase() }, {}, NOW)).toBe("scope=team&dept=sales");
  });
  it("accepts every show filter", () => {
    for (const show of ["workshops", "meetings", "tasks", "other"]) expect(parseCalParams({ show }, {}, NOW).show).toBe(show);
  });
  it("steps by view", () => {
    expect(stepDate("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(stepDate("week", "2026-12-15", -1)).toBe("2026-12-08");
    expect(stepDate("agenda", "2026-12-01", 1)).toBe("2026-12-31");
  });
  it("gives the days each view shows", () => {
    const m = viewRange("month", "2026-12-02");
    expect(m.days).toHaveLength(35);
    expect(m.days[0]).toBe("2026-11-30");
    expect(viewRange("week", "2026-12-02").days).toHaveLength(7);
    expect(viewRange("agenda", "2026-12-02").days).toHaveLength(30);
    expect(viewRange("week", "2026-12-02").from).toBe("2026-11-29T18:30:00.000Z");
  });
  it("titles each range", () => {
    expect(rangeTitle("month", "2026-12-02")).toBe("December 2026");
    expect(rangeTitle("week", "2026-12-02")).toContain("30 Nov");
  });
});

describe("items by day", () => {
  const item = (key: string, a: string, b: string) => ({ key, starts_at: a, ends_at: b });
  it("puts a meeting on its India day", () => {
    expect(itemDays(item("a", "2026-12-02T19:00:00Z", "2026-12-02T20:00:00Z"))).toEqual(["2026-12-03"]);
  });
  it("spreads a multi day workshop and stops at midnight", () => {
    expect(itemDays(item("a", "2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z"))).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(itemDays(item("a", "2026-12-01T04:00:00Z", "2026-12-01T18:30:00Z"))).toEqual(["2026-12-01"]);
  });
  it("sorts each day by start", () => {
    const m = itemsByDay([item("b", "2026-12-02T08:00:00Z", "2026-12-02T09:00:00Z"), item("a", "2026-12-02T04:00:00Z", "2026-12-02T05:00:00Z")]);
    expect(m.get("2026-12-02")?.map((i) => i.key)).toEqual(["a", "b"]);
  });
  it("lists workshops first, then meetings, then tasks, then the rest, each by start", () => {
    const g = (key: string, group: "workshop" | "meeting" | "task" | "other", a: string, b: string) => ({ ...item(key, a, b), group });
    const m = itemsByDay([
      g("other", "other", "2026-12-02T03:00:00Z", "2026-12-02T03:30:00Z"),
      g("task", "task", "2026-12-01T18:30:00Z", "2026-12-02T18:30:00Z"),
      g("meet2", "meeting", "2026-12-02T08:00:00Z", "2026-12-02T09:00:00Z"),
      g("meet1", "meeting", "2026-12-02T05:00:00Z", "2026-12-02T06:00:00Z"),
      g("ws", "workshop", "2026-12-02T09:00:00Z", "2026-12-02T10:00:00Z"),
    ]);
    expect(m.get("2026-12-02")?.map((i) => i.key)).toEqual(["ws", "meet1", "meet2", "task", "other"]);
  });
  it("places a due date on exactly one India day", () => {
    const r = allDayRange("2026-12-05");
    expect(itemDays(r)).toEqual(["2026-12-05"]);
  });
  it("numbers the days of a multi-day workshop", () => {
    const w = item("w", "2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z");
    expect(dayPosition(w, "2026-12-02")).toEqual({ n: 2, of: 3 });
    expect(dayPosition(w, "2026-12-09")).toBeNull();
    expect(dayPosition(item("a", "2026-12-01T04:00:00Z", "2026-12-01T10:00:00Z"), "2026-12-01")).toBeNull();
  });
  it("lays workshops out as bars across the week", () => {
    const week = weekDays("2026-12-02"); // 30 Nov - 6 Dec
    const three = item("three", "2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z"); // 1 - 3 Dec
    const one = item("one", "2026-12-02T04:00:00Z", "2026-12-02T10:00:00Z"); // 2 Dec, overlaps the bar above
    const later = item("later", "2026-12-04T04:00:00Z", "2026-12-04T10:00:00Z");
    const lanes = layoutBanners([three, one, later], week);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.map((b) => [b.item.key, b.col, b.span])).toEqual([["three", 1, 3], ["later", 4, 1]]);
    expect(lanes[1]?.map((b) => [b.item.key, b.col, b.span])).toEqual([["one", 2, 1]]);
  });
  it("cuts a bar at the week edges and says it continues", () => {
    const week = weekDays("2026-12-02");
    const long = item("long", "2026-11-27T04:00:00Z", "2026-12-08T10:00:00Z");
    expect(layoutBanners([long], week)[0]?.[0]).toMatchObject({ col: 0, span: 7, continuesBefore: true, continuesAfter: true });
    expect(layoutBanners([item("out", "2026-12-20T04:00:00Z", "2026-12-20T10:00:00Z")], week)).toEqual([]);
  });
  it("finds double bookings", () => {
    const hit = overlaps([
      item("a", "2026-12-02T04:00:00Z", "2026-12-02T05:00:00Z"),
      item("b", "2026-12-02T04:30:00Z", "2026-12-02T05:30:00Z"),
      item("c", "2026-12-02T05:30:00Z", "2026-12-02T06:00:00Z"),
    ]);
    expect([...hit].sort()).toEqual(["a", "b"]);
  });
});

describe("schedule form", () => {
  const base = {
    title: "  Pricing sync ", description: "", location: "", kind: "team", visibility: "invitees", department: "", date: "2026-12-10",
    start_time: "10:00", end_time: "10:30", attendees: [id], institution_id: "", mode: "schedule", host_id: "", repeat: "none", ends_on: "", all_department: false,
  } as const;
  it("accepts a plain meeting and trims", () => {
    const r = scheduleMeetingSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("Pricing sync");
  });
  it("needs the end after the start", () => {
    const r = scheduleMeetingSchema.safeParse({ ...base, end_time: "09:00" });
    expect(r.success).toBe(false);
  });
  it("a request needs someone to ask and cannot repeat", () => {
    expect(scheduleMeetingSchema.safeParse({ ...base, mode: "request" }).success).toBe(false);
    expect(scheduleMeetingSchema.safeParse({ ...base, mode: "request", host_id: id2 }).success).toBe(true);
    expect(scheduleMeetingSchema.safeParse({ ...base, mode: "request", host_id: id2, repeat: "weekly" }).success).toBe(false);
  });
  it("a repeating meeting needs people or a whole department", () => {
    expect(scheduleMeetingSchema.safeParse({ ...base, repeat: "weekly", attendees: [] }).success).toBe(false);
    expect(scheduleMeetingSchema.safeParse({ ...base, repeat: "weekly", all_department: true }).success).toBe(false);
    expect(scheduleMeetingSchema.safeParse({ ...base, repeat: "weekly", all_department: true, department: "workshop", attendees: [] }).success).toBe(true);
  });
  it("opening to a department needs the department", () => {
    expect(scheduleMeetingSchema.safeParse({ ...base, visibility: "department" }).success).toBe(false);
    expect(scheduleMeetingSchema.safeParse({ ...base, visibility: "department", department: "sales" }).success).toBe(true);
  });
});

describe("answering a request", () => {
  it("a decline needs a reason", () => {
    expect(answerRequestSchema.safeParse({ id, action: "decline" }).success).toBe(false);
    expect(answerRequestSchema.safeParse({ id, action: "decline", note: "On a school visit" }).success).toBe(true);
  });
  it("a new time needs a date and both times", () => {
    expect(answerRequestSchema.safeParse({ id, action: "propose" }).success).toBe(false);
    expect(answerRequestSchema.safeParse({ id, action: "propose", date: "2026-12-10", start_time: "15:00", end_time: "14:00" }).success).toBe(false);
    expect(answerRequestSchema.safeParse({ id, action: "propose", date: "2026-12-10", start_time: "15:00", end_time: "16:00" }).success).toBe(true);
  });
  it("accepting needs nothing more", () => {
    expect(answerRequestSchema.safeParse({ id, action: "accept" }).success).toBe(true);
  });
});

describe("fixed meeting form", () => {
  const base = {
    title: "Stand-up", description: "", location: "", kind: "team", visibility: "invitees", department: "", frequency: "weekly", weekday: 1,
    start_time: "09:30", duration_minutes: 15, starts_on: "2026-12-07", ends_on: "", all_department: false, staff_ids: [id],
  } as const;
  it("accepts weekly with people", () => expect(seriesSchema.safeParse(base).success).toBe(true));
  it("weekly needs a weekday, monthly a day of the month", () => {
    expect(seriesSchema.safeParse({ ...base, weekday: undefined }).success).toBe(false);
    expect(seriesSchema.safeParse({ ...base, frequency: "monthly" }).success).toBe(false);
    expect(seriesSchema.safeParse({ ...base, frequency: "monthly", month_day: 29 }).success).toBe(false);
    expect(seriesSchema.safeParse({ ...base, frequency: "monthly", month_day: 15 }).success).toBe(true);
  });
  it("needs people", () => expect(seriesSchema.safeParse({ ...base, staff_ids: [] }).success).toBe(false));
  it("the end cannot be before the start", () => expect(seriesSchema.safeParse({ ...base, ends_on: "2026-12-01" }).success).toBe(false));
});
