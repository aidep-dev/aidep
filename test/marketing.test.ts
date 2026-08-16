import { describe, expect, it } from "vitest";
import { daysLabel, daysUntil } from "../app/(marketing)/dates.ts";

describe("countdown math", () => {
  it("counts whole days regardless of time of day", () => {
    expect(daysUntil("2026-08-26", new Date("2026-08-16T00:01:00Z"))).toBe(10);
    expect(daysUntil("2026-08-26", new Date("2026-08-16T23:59:00Z"))).toBe(10);
    expect(daysUntil("2026-08-16", new Date("2026-08-16T12:00:00Z"))).toBe(0);
    expect(daysUntil("2025-10-28", new Date("2026-08-16T12:00:00Z"))).toBeLessThan(0);
  });

  it("labels chips with text, never color alone", () => {
    expect(daysLabel(0)).toBe("calls fail today");
    expect(daysLabel(-30)).toBe("calls fail today");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(10)).toBe("10 days");
  });
});
