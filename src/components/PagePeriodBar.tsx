import CustomDateTimeRange, { ensureCustomRangeDefaults } from './CustomDateTimeRange';
import {
  type PageDateRange,
  PAGE_PERIOD_LABELS,
} from '../lib/pagePeriod';

interface Props {
  value: PageDateRange;
  onChange: (v: PageDateRange) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  stackedCustom?: boolean;
  className?: string;
}

const OPTIONS: PageDateRange[] = ['today', '7days', '30days', 'custom'];

export default function PagePeriodBar({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  stackedCustom = false,
  className = '',
}: Props) {
  const pick = (next: PageDateRange) => {
    onChange(next);
    if (next === 'custom') {
      ensureCustomRangeDefaults(customFrom, customTo, onCustomFromChange, onCustomToChange);
    }
  };

  return (
    <div className={`bpl-page-period${className ? ` ${className}` : ''}`}>
      <div className="bpl-page-period-chips">
        {OPTIONS.map(r => (
          <button
            key={r}
            type="button"
            className={`bpl-page-period-chip${value === r ? ' active' : ''}`}
            onClick={() => pick(r)}
          >
            {PAGE_PERIOD_LABELS[r]}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <CustomDateTimeRange
          stacked={stackedCustom}
          from={customFrom}
          to={customTo}
          onFromChange={onCustomFromChange}
          onToChange={onCustomToChange}
        />
      )}
    </div>
  );
}

export { ensureCustomRangeDefaults };
