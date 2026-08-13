import type { LogEntry } from '../reportExport';
import { logEntriesToTabular } from '../reportExport';
import type { TabularReport } from '../reportTypes';

export function buildEventReport(
  entries: LogEntry[],
  reportTitle: string,
  meta: string,
): TabularReport {
  return logEntriesToTabular(entries, reportTitle, meta);
}
