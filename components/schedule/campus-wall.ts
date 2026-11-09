import { campusClock, campusInstant } from "@/lib/domain/handoff-slots";

/**
 * The scheduler lays dates out in the browser's own time zone. Handing it the
 * campus wall clock as a local date makes every viewer see campus time, and
 * a dropped slot reads back as the campus hour it landed on.
 */
export function toWall(instant: string | Date): Date {
  const { day, hour, minute } = campusClock(new Date(instant));
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute);
}

export function fromWall(wall: Date): Date {
  const day = `${wall.getFullYear()}-${String(wall.getMonth() + 1).padStart(2, "0")}-${String(wall.getDate()).padStart(2, "0")}`;
  return new Date(campusInstant(day, wall.getHours()).getTime() + wall.getMinutes() * 60_000);
}
