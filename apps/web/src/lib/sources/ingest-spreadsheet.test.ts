import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { extractSpreadsheetRecords } from "./ingest-spreadsheet";

async function workbookBytes(
  build: (workbook: ExcelJS.Workbook) => void,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("extractSpreadsheetRecords", () => {
  it("turns each row into labelled field text", async () => {
    const data = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Products");
      sheet.addRow(["Name", "Price", "Stock"]);
      sheet.addRow(["Blue widget", "12.50", "in stock"]);
    });

    const records = await extractSpreadsheetRecords(data, "catalog.xlsx");
    expect(records).toHaveLength(1);
    // Header pairing is what gives the embedding meaning; a bare row of cells
    // would retrieve poorly.
    expect(records[0].content).toContain("Name: Blue widget");
    expect(records[0].content).toContain("Price: 12.5");
    expect(records[0].metadata).toMatchObject({ sheet: "Products", row: 2 });
  });

  it("reads every sheet in the workbook", async () => {
    const data = await workbookBytes((workbook) => {
      const a = workbook.addWorksheet("Refunds");
      a.addRow(["Question", "Answer"]);
      a.addRow(["How long?", "Thirty days"]);
      const b = workbook.addWorksheet("Shipping");
      b.addRow(["Question", "Answer"]);
      b.addRow(["Where?", "Worldwide"]);
    });

    const records = await extractSpreadsheetRecords(data, "faq.xlsx");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.metadata.sheet).sort()).toEqual([
      "Refunds",
      "Shipping",
    ]);
  });

  it("skips a sheet that has only headers", async () => {
    const data = await workbookBytes((workbook) => {
      workbook.addWorksheet("Empty").addRow(["Name", "Price"]);
    });
    expect(await extractSpreadsheetRecords(data, "empty.xlsx")).toEqual([]);
  });

  it("omits empty cells rather than emitting bare labels", async () => {
    const data = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Sparse");
      sheet.addRow(["Name", "Notes"]);
      sheet.addRow(["Widget", ""]);
    });
    const records = await extractSpreadsheetRecords(data, "sparse.xlsx");
    expect(records[0].content).toBe("Name: Widget");
    expect(records[0].content).not.toContain("Notes:");
  });
});
