/**
 * Lakeshore University, the fictional demo campus. It runs on quarters, so
 * fall move out in December sits three weeks before winter move in, and
 * spring move out in June sits three months before fall move in. Times are
 * campus local (Central Time).
 */

export const CAMPUS = "lakeshore";
export const UNIVERSITY = "Lakeshore University";

export interface Window {
  startsAt: Date;
  endsAt: Date;
}

export const span = (startsAt: string, endsAt: string): Window => ({
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

export const CALENDAR = {
  /** Residence halls close at noon on Saturday after fall finals. */
  fall2026MoveOut: span("2026-12-11T08:00:00-06:00", "2026-12-12T12:00:00-06:00"),
  winter2027MoveIn: span("2027-01-02T09:00:00-06:00", "2027-01-04T18:00:00-06:00"),
  /** Halls close two days after commencement on 2027-06-12. */
  spring2027MoveOut: span("2027-06-12T09:00:00-05:00", "2027-06-14T12:00:00-05:00"),
  fall2027MoveIn: span("2027-09-17T09:00:00-05:00", "2027-09-20T18:00:00-05:00"),
} as const;

export const PRESET_SLUGS = {
  harborDouble: "harbor-hall-double",
  birchwoodSingle: "birchwood-house-single",
  breakwaterBedroom: "breakwater-apartments-bedroom",
} as const;
