import { describe, expect, it } from "vitest";
import {
  columnName,
  detectLayout,
  displayName,
  parseAmount,
  parseInstalmentCell,
  parsePeople,
  SAMPLE_YEAR_SHEET,
} from "@/app/(staff)/import/year-sheet-parse";

describe("parseInstalmentCell", () => {
  it("reads cash and M-Pesa amounts in the treasurer's notations", () => {
    expect(parseInstalmentCell("1000")).toEqual([{ amountCents: 100_000, method: "cash", raw: "1000" }]);
    for (const cell of ["3200-M", "3200 -M", "3200- M", "3,200-M", "3200 M", "3200(M)"]) {
      expect(parseInstalmentCell(cell), cell).toEqual([{ amountCents: 320_000, method: "mpesa", raw: expect.any(String) }]);
    }
  });

  it("splits a cell holding two payments", () => {
    expect(parseInstalmentCell("1000 3200-M")?.map((p) => [p.amountCents, p.method])).toEqual([
      [100_000, "cash"],
      [320_000, "mpesa"],
    ]);
  });

  it("returns [] for empty cells and null for text", () => {
    expect(parseInstalmentCell("  ")).toEqual([]);
    expect(parseInstalmentCell("paid")).toBeNull();
    expect(parseInstalmentCell("0")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles commas, KSh and blanks", () => {
    expect(parseAmount("20,000")).toBe(2_000_000);
    expect(parseAmount("KSh 500")).toBe(50_000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("displayName", () => {
  it("turns capitals into normal names, keeping titles, initials and acronyms", () => {
    expect(displayName("MEMBER ONE")).toBe("Member One");
    expect(displayName("PROF. A. MEMBER-TWO")).toBe("Prof. A. Member-Two");
    expect(displayName("CPA MEMBER FOUR")).toBe("CPA Member Four");
    expect(displayName("JOHN K.  O’NEIL")).toBe("John K. O'Neil");
    expect(displayName("Already Mixed")).toBe("Already Mixed");
  });
});

describe("detectLayout + parsePeople on the sample sheet", () => {
  const layout = detectLayout(SAMPLE_YEAR_SHEET)!;

  it("finds the year, the columns, and drops the duplicate total column", () => {
    expect(layout).toMatchObject({ year: 2025, headerRow: 1, nameCol: 1, quotaCol: 2, totalCol: 8, remarksCol: 9 });
    expect(layout.instalmentCols).toEqual([3, 4, 5, 6]);
  });

  const people = parsePeople(SAMPLE_YEAR_SHEET, layout);
  const byLine = Object.fromEntries(people.map((p) => [p.line, p]));

  it("reads each person with quota, instalments and totals", () => {
    expect(people).toHaveLength(8);
    expect(byLine[5]).toMatchObject({ name: "Member Three", quotaCents: 1_500_000, paidCents: 1_520_000, totalCents: 1_520_000, errors: [], warnings: [] });
    expect(byLine[5].instalments.map((i) => i.method)).toEqual(["cash", "cash", "cash", "mpesa"]);
  });

  it("flags totals that don't match and CLEARED rows that are short", () => {
    expect(byLine[8].warnings.join(" ")).toMatch(/add up to KSh 500 but the total column says KSh 700/);
    expect(byLine[9].warnings.join(" ")).toMatch(/CLEARED but KSh 800 short/);
  });

  it("keeps people with a quota and no payments", () => {
    expect(byLine[10]).toMatchObject({ name: "Member Eight", quotaCents: 500_000, instalments: [] });
  });
});

describe("parsePeople edge cases", () => {
  const header = [["NO.", "NAME", "QUOTA", "", "", "TOTAL", "REMARKS"]];

  it("flags amounts with no name and repeated names", () => {
    const grid = [...header, ["1", "A PERSON", "1000", "500", "", "500", ""], ["", "", "", "200", "", "200", ""], ["2", "A Person", "1000", "", "", "", ""]];
    const layout = detectLayout(grid)!;
    const people = parsePeople(grid, layout);
    expect(people[1].errors.join(" ")).toMatch(/no name/);
    expect(people[2].errors.join(" ")).toMatch(/Same name as row 2/);
  });

  it("names columns like Excel", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(27)]).toEqual(["A", "Z", "AA", "AB"]);
  });
});
