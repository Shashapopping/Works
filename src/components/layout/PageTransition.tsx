import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PageLoader from './PageLoader';

/**
 * Content-area route outlet.
 * Loader only appears while a lazy route chunk is actually loading (Suspense).
 * No artificial delay after the page is ready — tap → page as soon as it can paint.
 */
export default function PageTransition() {
  const { pathname, search } = useLocation();
  const routeKey = `${pathname}${search}`;

  return (
    <div className="bpl-page-transition" key={routeKey}>
      <Suspense fallback={<PageLoader />}>
        <div className="bpl-page-transition__body">
          <Outlet />
        </div>
      </Suspense>
    </div>
  );
}
