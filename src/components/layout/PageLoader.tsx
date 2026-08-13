type PageLoaderProps = {
  /** Compact mode for nested surfaces; default fills the page content area */
  compact?: boolean;
};

export default function PageLoader({ compact = false }: PageLoaderProps) {
  return (
    <div
      className={`bpl-page-loader${compact ? ' bpl-page-loader--compact' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="bpl-page-loader__progress" aria-hidden />

      <div className="bpl-page-loader__header">
        <div className="bpl-page-loader__title-block">
          <span className="bpl-skel bpl-skel--title" />
          <span className="bpl-skel bpl-skel--sub" />
        </div>
        <div className="bpl-page-loader__mark" aria-hidden>
          <span className="bpl-page-loader__ring" />
          <span className="bpl-page-loader__ring bpl-page-loader__ring--delay" />
          <span className="bpl-page-loader__dot" />
        </div>
      </div>

      <div className="bpl-page-loader__kpis">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bpl-page-loader__kpi" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="bpl-skel bpl-skel--label" />
            <span className="bpl-skel bpl-skel--value" />
            <span className="bpl-skel bpl-skel--meta" />
          </div>
        ))}
      </div>

      <div className="bpl-page-loader__grid">
        <div className="bpl-page-loader__panel bpl-page-loader__panel--wide">
          <span className="bpl-skel bpl-skel--panel-title" />
          <div className="bpl-page-loader__chart">
            <span className="bpl-page-loader__bar" style={{ height: '42%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '68%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '55%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '82%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '48%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '74%' }} />
            <span className="bpl-page-loader__bar" style={{ height: '60%' }} />
          </div>
        </div>
        <div className="bpl-page-loader__panel">
          <span className="bpl-skel bpl-skel--panel-title" />
          <div className="bpl-page-loader__lines">
            <span className="bpl-skel bpl-skel--line" />
            <span className="bpl-skel bpl-skel--line bpl-skel--line-short" />
            <span className="bpl-skel bpl-skel--line" />
            <span className="bpl-skel bpl-skel--line bpl-skel--line-mid" />
            <span className="bpl-skel bpl-skel--line" />
          </div>
        </div>
      </div>

      <p className="bpl-page-loader__caption">Loading workspace</p>
    </div>
  );
}
