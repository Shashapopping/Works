import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Vehicle } from '../context/FleetContext';
import {
  READY_MIX_PLANT_RADIUS_M,
  haversineMeters,
} from '../lib/segmentMetrics';

type PlantPin = { id: string; label: string; lat: number; lng: number };

/** Distinct colours so Lagos hubs read as separate plants, not one blob. */
const PIN_COLORS = [
  '#16a34a', '#0d9488', '#2563eb', '#ca8a04', '#db2777', '#7c3aed', '#ea580c', '#0891b2',
];

function colorForPin(id: string, index: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % PIN_COLORS.length;
  return PIN_COLORS[(h + index) % PIN_COLORS.length];
}

function plantIcon(color: string, letter: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:20px;height:20px;border-radius:6px;background:${color};
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font:700 9px/1 system-ui,sans-serif;
    ">${letter}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function mixerIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:11px;height:11px;border-radius:50%;background:${color};
      border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);
    "></div>`,
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
  });
}

function nearestPlant(v: Vehicle, pins: PlantPin[]) {
  const lat = Number(v.position?.latitude);
  const lng = Number(v.position?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: { pin: PlantPin; meters: number } | null = null;
  for (const pin of pins) {
    const meters = haversineMeters(lat, lng, pin.lat, pin.lng);
    if (!best || meters < best.meters) best = { pin, meters };
  }
  return best;
}

/**
 * Compact proof map: separate plant pins (+ rings) and mixers counted as At plant.
 * Pinch/scroll zoom is kept — data refresh does not reset the view after you move.
 */
export default function ReadyMixPlantMap({
  plantPins,
  atPlantVehicles,
}: {
  plantPins: PlantPin[];
  atPlantVehicles: Vehicle[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const userMovedRef = useRef(false);
  const didFitRef = useRef(false);

  const activePins = useMemo(() => {
    const withMixers = plantPins.filter(p =>
      atPlantVehicles.some(v => {
        const lat = Number(v.position?.latitude);
        const lng = Number(v.position?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        return haversineMeters(lat, lng, p.lat, p.lng) <= READY_MIX_PLANT_RADIUS_M;
      }),
    );
    return withMixers.length > 0 ? withMixers : plantPins.slice(0, 8);
  }, [plantPins, atPlantVehicles]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      touchZoom: true,
      dragging: true,
      doubleClickZoom: true,
      boxZoom: true,
    }).setView([6.55, 3.4], 10);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const markMoved = () => { userMovedRef.current = true; };
    map.on('zoomstart', markMoved);
    map.on('dragstart', markMoved);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.off('zoomstart', markMoved);
      map.off('dragstart', markMoved);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const bounds: L.LatLngExpression[] = [];
    const pinColorById = new Map<string, string>();

    activePins.forEach((p, i) => {
      const color = colorForPin(p.id, i);
      pinColorById.set(p.id, color);
      L.circle([p.lat, p.lng], {
        radius: READY_MIX_PLANT_RADIUS_M,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.1,
      }).addTo(layer);
      const letter = (p.label.match(/[A-Z]/g)?.[0] || 'P');
      L.marker([p.lat, p.lng], { icon: plantIcon(color, letter) })
        .bindTooltip(`Plant: ${p.label}`, { direction: 'top', opacity: 0.95 })
        .addTo(layer);
      bounds.push([p.lat, p.lng]);
    });

    for (const v of atPlantVehicles) {
      const lat = Number(v.position?.latitude);
      const lng = Number(v.position?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const nearest = nearestPlant(v, activePins.length ? activePins : plantPins);
      const color = nearest ? (pinColorById.get(nearest.pin.id) || '#0f766e') : '#0f766e';
      L.marker([lat, lng], { icon: mixerIcon(color) })
        .bindTooltip(
          `${v.regNo} · ${nearest ? nearest.pin.label : 'at plant'} · ${nearest ? `${Math.round(nearest.meters)} m` : ''}`,
          { direction: 'top', opacity: 0.95 },
        )
        .addTo(layer);
      bounds.push([lat, lng]);
    }

    if (bounds.length > 0 && !userMovedRef.current && !didFitRef.current) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 12 });
      didFitRef.current = true;
    }
    map.invalidateSize();
  }, [activePins, atPlantVehicles, plantPins]);

  return (
    <div className="bpl-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
        padding: '10px 14px', borderBottom: '1px solid var(--cd-border)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)' }}>
            At plant — separate GPS plant hubs
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2, maxWidth: 640 }}>
            Each coloured ring is a different plant pin (Lagos has several: Lekki, Ikeja/north, Truluck, Epe, Sagamu corridor — not one yard).
            Pinch or scroll to zoom; your view stays after refresh. Dots = mixers in that ring ({atPlantVehicles.length}).
          </div>
        </div>
        <button
          type="button"
          className="bpl-btn-secondary"
          style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
          onClick={() => {
            userMovedRef.current = false;
            didFitRef.current = false;
            const map = mapRef.current;
            if (!map) return;
            const pts: L.LatLngExpression[] = [];
            for (const v of atPlantVehicles) {
              const lat = Number(v.position?.latitude);
              const lng = Number(v.position?.longitude);
              if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng]);
            }
            for (const p of activePins) pts.push([p.lat, p.lng]);
            if (pts.length) {
              map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 12 });
              didFitRef.current = true;
            }
          }}
        >
          Reset view
        </button>
      </div>

      <div ref={containerRef} style={{ height: 280, width: '100%', background: 'var(--cd-surface-2)', touchAction: 'none' }} />

      {activePins.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 14px',
          borderTop: '1px solid var(--cd-border)', fontSize: 11, color: 'var(--cd-text-muted)',
        }}>
          {activePins.map((p, i) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colorForPin(p.id, i) }} />
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
