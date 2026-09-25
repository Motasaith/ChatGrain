import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

/**
 * The admin exports carry text typed by people outside the company - visitor
 * names, ticket subjects, audit messages - into spreadsheets opened by people
 * inside it. Both halves of that are what these tests are about.
 */
describe("admin CSV", () => {
  it("quotes values that would otherwise shift the columns", () => {
    expect(csvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises values a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves numbers alone, including negative ones", () => {
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(0)).toBe("0");
  });

  it("writes dates as ISO, objects as JSON, and nulls as empty", () => {
    expect(csvCell(new Date("2026-09-25T10:00:00Z"))).toBe("2026-09-25T10:00:00.000Z");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("writes a header, CRLF rows, and a byte-order mark so Excel reads UTF-8", () => {
    const csv = toCsv([{ name: "Zoë", count: 2 }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿name,count\r\nZoë,2\r\n");
  });

  it("still writes the header row when there are no rows, if columns are given", () => {
    expect(toCsv([], ["a", "b"])).toBe("﻿a,b\r\n");
  });
});
