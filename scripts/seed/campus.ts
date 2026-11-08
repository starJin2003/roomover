/**
 * Lakeshore University, the fictional demo campus. It runs on quarters, so
 * the calendar has a fall move out before a winter move in and a spring move
 * out before a fall move in, with storage over the summer.
 *
 * Dates count from the day the seed runs, in campus time (Central Time). A
 * reseed on any day yields a winter cart whose handoffs fit inside one
 * PayPal authorization and storage carts that capture at checkout.
 */

export const CAMPUS = "lakeshore";
export const UNIVERSITY = "Lakeshore University";
export const CAMPUS_TIME_ZONE = "America/Chicago";

export interface Window {
  startsAt: Date;
  endsAt: Date;
}

/** A calendar day in campus time, written YYYY-MM-DD. */
export type CampusDay = string;

const CAMPUS_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{2}):(\d{2})$/;

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: CAMPUS_TIME_ZONE, timeZoneName: "longOffset" });

export function campusDay(instant: Date): CampusDay {
  const parts = Object.fromEntries(dayFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Campus UTC offset in milliseconds at an instant, such as -6 hours in winter. */
function campusOffsetMs(instant: Date): number {
  const name = offsetFormat.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -minutes : minutes) * 60_000;
}

/** The instant of a campus wall clock time `days` after the seed day. */
export function campusTime(seedDay: CampusDay, days: number, wallTime: string): Date {
  const day = CAMPUS_DAY.exec(seedDay);
  const time = WALL_TIME.exec(wallTime);
  if (day === null || time === null) throw new RangeError(`Expected YYYY-MM-DD and HH:MM, got ${seedDay} ${wallTime}.`);
  const wallClockAsUtc = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + days, Number(time[1]), Number(time[2]));
  // The offset at the wall clock read as UTC can sit on the other side of a
  // daylight saving switch, so check it again at the corrected instant.
  const firstGuess = wallClockAsUtc - campusOffsetMs(new Date(wallClockAsUtc));
  return new Date(wallClockAsUtc - campusOffsetMs(new Date(firstGuess)));
}

export const campusWindow = (
  seedDay: CampusDay,
  from: readonly [days: number, wallTime: string],
  to: readonly [days: number, wallTime: string],
): Window => ({
  startsAt: campusTime(seedDay, ...from),
  endsAt: campusTime(seedDay, ...to),
});

/**
 * Winter move in falls two weeks after the seed day, so a winter checkout
 * authorizes. Fall move in lands past the 29 day authorization and inside
 * 180 days of the seed day.
 */
export function campusCalendar(seedDay: CampusDay) {
  return {
    /** Residence halls close at noon the day after fall finals. */
    fallMoveOut: campusWindow(seedDay, [6, "08:00"], [7, "12:00"]),
    winterMoveIn: campusWindow(seedDay, [14, "09:00"], [16, "18:00"]),
    /** Halls close two days after commencement. */
    springMoveOut: campusWindow(seedDay, [75, "09:00"], [77, "12:00"]),
    fallMoveIn: campusWindow(seedDay, [160, "09:00"], [163, "18:00"]),
  };
}

export type CampusCalendar = ReturnType<typeof campusCalendar>;

export const PRESET_SLUGS = {
  harborDouble: "harbor-hall-double",
  birchwoodSingle: "birchwood-house-single",
  breakwaterBedroom: "breakwater-apartments-bedroom",
} as const;
