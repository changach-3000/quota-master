import { parseCsv } from "./parse";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Reads the first sheet of an .xlsx file, or a .csv, into a grid of text
 * cells. Everything happens in the browser; nothing is uploaded until the
 * treasurer confirms the import.
 */
export async function readGrid(file: File): Promise<string[][]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Files up to 5 MB, please.");
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    const rows = await readSheet(file);
    return rows.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        return String(cell);
      }),
    );
  }
  if (/\.xls$/i.test(file.name)) throw new Error("This is the old .xls format. In Excel, use File › Save As › Excel Workbook (.xlsx), then upload that.");
  throw new Error("Upload an Excel workbook (.xlsx) or a CSV file.");
}
