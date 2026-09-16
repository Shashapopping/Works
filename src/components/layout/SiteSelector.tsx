import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import SiteScopeDropdown from '../SiteScopeDropdown';

export default function SiteSelector() {
  const { user } = useAuth();
  const {
    selectedSites, setSelectedSites, toggleSite, siteOptions, siteNameOptions,
    siteLock, lockedTransporters,
  } = useFleet();
  return (
    <SiteScopeDropdown
      selectedSites={selectedSites}
      setSelectedSites={setSelectedSites}
      toggleSite={toggleSite}
      siteOptions={siteOptions}
      siteNameOptions={siteNameOptions}
      allowedSiteKeys={siteLock ? lockedTransporters : undefined}
      scopeLabel={user?.fleetName || undefined}
    />
  );
}
