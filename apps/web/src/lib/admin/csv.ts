/**
 * CSV for the admin exports.
 *
 * Two things a naive join gets wrong. Quoting: a workspace name with a comma
 * or a quote in it shifts every column after it. And formula injection: a
 * value that starts with `=`, `+`, `-` or `@` is executed by Excel and Sheets
 * when the file is opened, and several of these columns (visitor names, audit
 * messages, ticket subjects) are typed by people outside the company. Such a
 * value is prefixed with an apostrophe, which spreadsheets read as "this is
 * text" and do not display.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]) {
  const header = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(header.map((column) => csvCell(row[column])).join(","));
  }
  // CRLF is what RFC 4180 specifies, and a byte-order mark is what makes
  // Excel read the file as UTF-8 instead of mangling every accented name.
  return `﻿${lines.join("\r\n")}\r\n`;
}
