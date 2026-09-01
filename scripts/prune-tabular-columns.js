const EMPTY_EXPORT_CELLS = new Set(['', 'N/A', '—', '-']);

export function isEmptyExportCell(value) {
  return EMPTY_EXPORT_CELLS.has(String(value ?? '').trim());
}

function columnHasValue(rows, columnIndex) {
  return rows.some(row => !isEmptyExportCell(row[columnIndex] ?? ''));
}

/** Drop columns where every row is empty / N/A / —. */
export function pruneTabularColumns(report) {
  const { columns, rows } = report;
  if (!columns.length) return report;

  const keptIndices = columns
    .map((_, index) => index)
    .filter(index => columnHasValue(rows, index));

  if (keptIndices.length === columns.length) return report;

  return {
    ...report,
    columns: keptIndices.map(index => columns[index]),
    rows: rows.map(row => keptIndices.map(index => row[index] ?? '')),
  };
}
