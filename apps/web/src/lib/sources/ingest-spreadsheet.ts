import { ingestSourceRecords, type SourceRecord } from "./ingest-records";

/** Guards against a runaway generated sheet exhausting memory. */
const MAX_ROWS_PER_SHEET = 20_000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cell = value as {
      text?: unknown;
      result?: unknown;
      hyperlink?: unknown;
      richText?: Array<{ text?: unknown }>;
    };
    // Formula cells carry their computed `result`; a link carries `text`.
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => String(part.text ?? "")).join("");
    }
    if (cell.text !== undefined) return String(cell.text);
    if (cell.result !== undefined) return String(cell.result);
    if (cell.hyperlink !== undefined) return String(cell.hyperlink);
    return "";
  }
  return String(value);
}

/**
 * Reads every sheet of a workbook into one record per row.
 *
 * The first row is treated as headers so each record reads as
 * "Column: value" pairs, which gives the embedding real context instead of a
 * bare list of cells.
 */
export async function extractSpreadsheetRecords(
  data: Uint8Array,
  fileName: string,
): Promise<SourceRecord[]> {
  // Loaded on demand: the workbook parser is large and most sources are not
  // spreadsheets.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(buffer);

  const records: SourceRecord[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_ROWS_PER_SHEET) return;
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((value) => cellText(value).trim()));
    });
    if (rows.length < 2) return;

    const headers = rows[0].map(
      (value, index) => value || `Column ${index + 1}`,
    );
    for (let index = 1; index < rows.length; index += 1) {
      const cells = rows[index];
      const content = headers
        .map((header, column) =>
          cells[column] ? `${header}: ${cells[column]}` : "",
        )
        .filter(Boolean)
        .join("\n");
      if (!content) continue;
      records.push({
        title: `${sheet.name} — row ${index + 1}`,
        content,
        metadata: { sheet: sheet.name, row: index + 1, file: fileName },
      });
    }
  });
  return records;
}

export async function ingestSpreadsheetSource({
  agentId,
  name,
  data,
}: {
  agentId: string;
  name: string;
  data: Uint8Array;
}) {
  const records = await extractSpreadsheetRecords(data, name);
  return ingestSourceRecords({
    agentId,
    name,
    records,
    format: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: { rows: records.length },
  });
}
