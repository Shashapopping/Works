import type { TabularReport } from '../reportTypes';

const EMPTY_EXPORT_CELLS = new Set(['', 'N/A', '—', '-']);

export function isEmptyExportCell(value: string): boolean {
  return EMPTY_EXPORT_CELLS.has(String(value ?? '').trim());
}

function columnHasValue(rows: string[][], columnIndex: number): boolean {
  return rows.some(row => !isEmptyExportCell(row[columnIndex] ?? ''));
}

const ALWAYS_KEEP_HEADERS = new Set(['Last location', 'Remark']);

/** Drop columns where every row is empty / N/A / —. */
export function pruneTabularColumns(report: TabularReport): TabularReport {
  const { columns, rows } = report;
  if (!columns.length) return report;

  const keptIndices = columns
    .map((_, index) => index)
    .filter(index => ALWAYS_KEEP_HEADERS.has(columns[index].header) || columnHasValue(rows, index));

  if (keptIndices.length === columns.length) return report;

  return {
    ...report,
    columns: keptIndices.map(index => columns[index]),
    rows: rows.map(row => keptIndices.map(index => row[index] ?? '')),
  };
}
