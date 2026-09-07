import { useFleet } from '../../context/FleetContext';
import SiteScopeDropdown from '../SiteScopeDropdown';

export default function SiteSelector() {
  const {
    selectedSites, setSelectedSites, toggleSite, siteOptions, siteNameOptions,
    siteLock, lockedTransporter,
  } = useFleet();
  return (
    <SiteScopeDropdown
      selectedSites={selectedSites}
      setSelectedSites={setSelectedSites}
      toggleSite={toggleSite}
      siteOptions={siteOptions}
      siteNameOptions={siteNameOptions}
      locked={siteLock}
      lockedLabel={lockedTransporter || undefined}
    />
  );
}
