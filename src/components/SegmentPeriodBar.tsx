import PagePeriodBar from './PagePeriodBar';
import type { PageDateRange } from '../lib/pagePeriod';
import { SEGMENT_PERIOD_OPTIONS, type SegmentPeriod } from '../lib/segmentPeriod';

interface Props {
  period: SegmentPeriod;
  customRange: { from: string; to: string };
  onPeriod: (period: SegmentPeriod) => void;
  onCustomRange: (range: { from: string; to: string }) => void;
}

function toPagePeriod(period: SegmentPeriod): PageDateRange {
  if (period === 'today') return 'today';
  if (period === 'week') return '7days';
  if (period === 'month') return '30days';
  return 'custom';
}

function fromPagePeriod(period: PageDateRange): SegmentPeriod {
  if (period === 'today') return 'today';
  if (period === '7days') return 'week';
  if (period === '30days') return 'month';
  return 'custom';
}

export default function SegmentPeriodBar({
  period,
  customRange,
  onPeriod,
  onCustomRange,
}: Props) {
  return (
    <PagePeriodBar
      value={toPagePeriod(period)}
      onChange={next => onPeriod(fromPagePeriod(next))}
      customFrom={customRange.from}
      customTo={customRange.to}
      onCustomFromChange={from => onCustomRange({ ...customRange, from })}
      onCustomToChange={to => onCustomRange({ ...customRange, to })}
      className="bpl-segment-period"
    />
  );
}

export { SEGMENT_PERIOD_OPTIONS };
