import { describe, expect, test } from "vitest";
import { formatRelative } from "./format";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  test("test_just_now_under_a_minute", () => {
    expect(formatRelative(ago(0), NOW)).toBe("Just now");
    expect(formatRelative(ago(59 * SEC), NOW)).toBe("Just now");
  });

  test("test_minutes_hours_days_boundaries", () => {
    expect(formatRelative(ago(MIN), NOW)).toBe("1 minute ago");
    expect(formatRelative(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(formatRelative(ago(59 * MIN + 59 * SEC), NOW)).toBe("59 minutes ago");
    expect(formatRelative(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(formatRelative(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(formatRelative(ago(23 * HOUR + 59 * MIN), NOW)).toBe("23 hours ago");
    expect(formatRelative(ago(DAY), NOW)).toBe("1 day ago");
    expect(formatRelative(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(formatRelative(ago(7 * DAY), NOW)).toBe("7 days ago");
  });

  test("test_older_than_7_days_shows_date", () => {
    expect(formatRelative(ago(7 * DAY + MIN), NOW)).toBe("21 Sep 2026");
    expect(formatRelative("2026-09-12T08:00:00.000Z", NOW)).toBe("12 Sep 2026");
    // UTC, not the machine timezone: 23:30 UTC on 1 Jan stays 1 Jan.
    expect(formatRelative("2025-01-01T23:30:00.000Z", NOW)).toBe("1 Jan 2025");
  });

  test("test_future_date_shows_just_now", () => {
    expect(formatRelative(new Date(NOW.getTime() + 3 * HOUR).toISOString(), NOW)).toBe("Just now");
  });

  test("invalid input returns an empty string instead of throwing", () => {
    expect(formatRelative("not a date", NOW)).toBe("");
  });
});
