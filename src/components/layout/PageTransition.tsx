import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import PageLoader from './PageLoader';

function DelayedPageLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? <PageLoader /> : null;
}

/**
 * Content-area route outlet.
 * Loader only appears while a lazy route chunk is actually loading (Suspense).
 * No artificial delay after the page is ready — tap → page as soon as it can paint.
 */
export default function PageTransition() {
  return (
    <div className="bpl-page-transition">
      <Suspense fallback={<DelayedPageLoader />}>
        <div className="bpl-page-transition__body">
          <Outlet />
        </div>
      </Suspense>
    </div>
  );
}
