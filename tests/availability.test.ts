import { describe, expect, it } from "vitest";
import { computeSlots, subtract } from "@/lib/booking/availability";

const t = (h: number, m = 0) => h * 60 + m;

describe("subtract", () => {
  it("splits intervals", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
  });
});

describe("computeSlots", () => {
  const base = { branchOpen: { start: t(9), end: t(21) }, bufferMin: 0, intervalMin: 30, earliestStartMin: 0 };
  it("respects shifts, breaks and duration", () => {
    const slots = computeSlots({ ...base, durationMin: 60, employees: [{ employeeId: "a", shifts: [{ start: t(9), end: t(12) }], breaks: [{ start: t(10), end: t(10, 30) }], busy: [] }] });
    expect(slots.map((s) => s.start)).toEqual([t(9), t(10, 30), t(11)]);
  });
  it("excludes busy periods and honours buffer before next booking", () => {
    const slots = computeSlots({ ...base, bufferMin: 15, durationMin: 30, employees: [{ employeeId: "a", shifts: [{ start: t(9), end: t(11) }], breaks: [], busy: [{ start: t(10), end: t(10, 45) }] }] });
    // 9:00 (ends 9:30 + 15 buffer = 9:45 <= 10:00) ok; 9:30 needs until 10:15 -> collides
    expect(slots.map((s) => s.start)).toEqual([t(9)]);
  });
  it("allows buffer to run past shift end", () => {
    const slots = computeSlots({ ...base, bufferMin: 30, durationMin: 60, employees: [{ employeeId: "a", shifts: [{ start: t(9), end: t(10) }], breaks: [], busy: [] }] });
    expect(slots.map((s) => s.start)).toEqual([t(9)]);
  });
  it("clips to branch hours and lead time and merges employees", () => {
    const slots = computeSlots({ ...base, branchOpen: { start: t(10), end: t(12) }, earliestStartMin: t(10, 10), durationMin: 60, employees: [
      { employeeId: "a", shifts: [{ start: t(9), end: t(17) }], breaks: [], busy: [] },
      { employeeId: "b", shifts: [{ start: t(11), end: t(17) }], breaks: [], busy: [] },
    ] });
    expect(slots).toEqual([{ start: t(10, 30), employeeIds: ["a"] }, { start: t(11), employeeIds: ["a", "b"] }]);
  });
  it("closed day returns nothing", () => {
    expect(computeSlots({ ...base, branchOpen: null, durationMin: 30, employees: [] })).toEqual([]);
  });
});
