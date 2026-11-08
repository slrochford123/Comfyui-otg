const newYorkDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const newYorkOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", timeZoneName: "longOffset",
});

export function productionBudgetEnabled() {
  return process.env.OTG_ENV === "prod" || process.env.OTG_ENV === "production";
}

export function newYorkBudgetDayStart(now: number) {
  const day = newYorkDate.format(now);
  // The offset at UTC midnight still applies at the following New York midnight.
  // New York's DST transitions are later in the local morning.
  const offset = newYorkOffset.formatToParts(Date.parse(day + "T00:00:00Z"))
    .find(part => part.type === "timeZoneName")?.value.slice(3);
  const start = Date.parse(day + "T00:00:00" + offset);
  if (!Number.isFinite(start)) throw new Error("New York OpenAI budget day could not be determined.");
  return start;
}
