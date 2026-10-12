const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Fixed month names: ICU versions disagree on "Sep" vs "Sept" for en-IN, and
// server and browser must print the same string to avoid hydration mismatches.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** Day-month-year in UTC, en-IN order: "12 Sep 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * "Just now", "5 minutes ago", "2 hours ago", "3 days ago" up to 7 days,
 * then a UTC date like "12 Sep 2026". Future dates read as "Just now".
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now.getTime() - then;
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour");
  if (diff <= 7 * DAY) return plural(Math.floor(diff / DAY), "day");
  return formatDate(iso);
}
