/**
 * Pure availability computation — no I/O, fully unit-tested.
 * All "minutes" are minutes since local midnight (Asia/Riyadh) on the requested date.
 */
export type Interval = { start: number; end: number };

export type EmployeeDay = {
  employeeId: string;
  shifts: Interval[];        // working hours for that weekday
  breaks: Interval[];        // recurring breaks for that weekday
  busy: Interval[];          // existing active bookings (incl. buffer) + time off + blocked slots, clipped to the day
};

export type DayInput = {
  branchOpen: Interval | null;  // null => closed (holiday or closed weekday)
  employees: EmployeeDay[];
  durationMin: number;          // total duration of all selected services
  bufferMin: number;            // cleanup buffer after each appointment
  intervalMin: number;          // slot grid
  earliestStartMin: number;     // lead-time cutoff (e.g. now + min_lead on the same day); 0 for future days
};

export type Slot = { start: number; employeeIds: string[] };

export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  let out = base.map((i) => ({ ...i }));
  for (const c of cut) {
    const next: Interval[] = [];
    for (const i of out) {
      if (c.end <= i.start || c.start >= i.end) { next.push(i); continue; }
      if (c.start > i.start) next.push({ start: i.start, end: c.start });
      if (c.end < i.end) next.push({ start: c.end, end: i.end });
    }
    out = next;
  }
  return out.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
}

export function intersect(a: Interval[], b: Interval): Interval[] {
  return a.map((i) => ({ start: Math.max(i.start, b.start), end: Math.min(i.end, b.end) })).filter((i) => i.end > i.start);
}

/** Free windows of a single employee on a day. */
export function freeWindows(e: EmployeeDay, branchOpen: Interval): Interval[] {
  return subtract(intersect(e.shifts, branchOpen), [...e.breaks, ...e.busy]);
}

/**
 * Returns start times where at least one employee can perform the whole appointment.
 * The appointment occupies [start, start + duration) and the employee must also be free for the buffer
 * afterwards ([start + duration, start + duration + buffer)), except the buffer may extend past closing time.
 */
export function computeSlots(input: DayInput): Slot[] {
  const { branchOpen, durationMin, bufferMin, intervalMin, earliestStartMin } = input;
  if (!branchOpen || durationMin <= 0) return [];
  const byStart = new Map<number, string[]>();
  for (const e of input.employees) {
    // Busy intervals already include their own buffer; our appointment needs its buffer free too,
    // except past the end of the shift (cleanup can happen after closing).
    const windows = freeWindows(e, branchOpen);
    for (const w of windows) {
      const first = Math.max(w.start, earliestStartMin);
      let s = Math.ceil(first / intervalMin) * intervalMin;
      for (; s + durationMin <= w.end; s += intervalMin) {
        const needEnd = s + durationMin + bufferMin;
        const shiftEnd = Math.min(branchOpen.end, ...e.shifts.filter((sh) => sh.start <= s && sh.end >= s + durationMin).map((sh) => sh.end));
        if (needEnd > w.end && w.end < shiftEnd) continue; // buffer collides with the next busy block
        const list = byStart.get(s) ?? [];
        list.push(e.employeeId);
        byStart.set(s, list);
      }
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, employeeIds]) => ({ start, employeeIds }));
}
