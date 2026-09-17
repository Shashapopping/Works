import { useState, useEffect, useCallback } from 'react';

export type IncidentType = 'harsh_braking' | 'harsh_acceleration' | 'speeding' | 'excessive_idling';
export type Severity = 'RED' | 'YELLOW' | 'GREEN';

export interface DriverContext {
  id: string;
  name: string;
  safety_score_baseline: number;
  incidents_last_30_days: number;
  improvement_trend: 'improving' | 'stable' | 'declining';
}

export interface VehicleContext {
  id: string;
  type: 'truck' | 'tanker' | 'van';
  last_maintenance: string;
  make?: string;
  model?: string;
}

export interface EnvironmentContext {
  weather: string;
  weather_condition?: string;
  temperature_c?: number;
  humidity_pct?: number;
  precipitation_mm?: number;
  traffic_density: 'light' | 'moderate' | 'heavy';
  traffic_description?: string;
  current_speed_kmh?: number;
  free_flow_speed_kmh?: number;
  traffic_delay_pct?: number;
  road_type: 'highway' | 'urban' | 'rural';
  environment_source?: { weather: string; traffic: string };
}

export interface IndustryCitation {
  label: string;
  url: string;
  /** Short note shown on the citation chip (what this source supports). */
  note: string;
}

export interface SafeIQAnalysis {
  severity: Severity;
  severity_reason: string;
  root_cause: string;
  industry_reference: string;
  /** Sources for the industry paragraph — shown as openable chips under it. */
  industry_citations?: IndustryCitation[];
  coaching_recommendation: string;
  ops_flag: boolean;
  ops_flag_reason: string;
}

export interface SafetyNotification {
  id: string;
  type: IncidentType;
  magnitude: string;
  timestamp: string;
  location: string;
  driver: DriverContext;
  vehicle: VehicleContext;
  environment: EnvironmentContext;
  analysis: SafeIQAnalysis | null;
  analysisLoading: boolean;
  eventCount: number;
}

const MOCK_INCIDENTS: Omit<SafetyNotification, 'analysisLoading'>[] = [
  {
    id: 'inc-001',
    type: 'harsh_braking',
    magnitude: '0.48G',
    timestamp: new Date(Date.now() - 90000).toISOString(),
    location: 'Lagos-Ibadan Expressway KM 47',
    driver: {
      id: 'drv-001',
      name: 'Emmanuel Adeyemi',
      safety_score_baseline: 58,
      incidents_last_30_days: 11,
      improvement_trend: 'declining',
    },
    vehicle: {
      id: 'JMG-0042',
      type: 'truck',
      last_maintenance: 'December 2024',
    },
    environment: {
      weather: 'Rain',
      traffic_density: 'heavy',
      road_type: 'highway',
    },
    analysis: {
      severity: 'RED',
      severity_reason: 'Harsh braking at 0.48G in wet heavy-traffic conditions compounds rear-end collision risk by 3.4×.',
      root_cause: 'Wet road conditions on the Lagos-Ibadan Expressway significantly reduce tyre adhesion, requiring at least 40% greater stopping distances than dry-road benchmarks — a factor this driver has not accounted for. Aggressive following distances combined with a declining safety trend (11 incidents in 30 days) indicate a persistent behavioural pattern rather than an isolated lapse. The maintenance gap since December 2024 raises an additional concern about brake pad wear, which compounds stopping distance on a vehicle already operating in high-risk conditions.',
      industry_reference: 'FMCSA BASIC Category 1 (Unsafe Driving) — harsh braking frequency is a primary predictor of rear-end collision risk; drivers above 8 events per 30 days are flagged for formal intervention. FRSC Highway Code Section 14(3) specifies minimum following distances in adverse weather and mandates driver awareness of wet-road stopping distance increases.',
      coaching_recommendation: 'Schedule a mandatory defensive driving refresher within 5 days, with specific emphasis on the 4-second wet-road following rule. Conduct a brake system inspection on JMG-0042 before the vehicle returns to highway routes. Supervisor must issue a formal written warning given the 11-incident threshold breach.',
      ops_flag: true,
      ops_flag_reason: 'Emmanuel Adeyemi has crossed the 8-incident-per-30-days intervention threshold (currently at 11). Immediate supervisor notification is required. Fleet management should evaluate reassignment from highway routes to lower-risk urban or short-haul routes pending completion of the mandatory refresher and vehicle brake inspection.',
    },
  },
  {
    id: 'inc-002',
    type: 'speeding',
    magnitude: '+24 km/h over limit',
    timestamp: new Date(Date.now() - 180000).toISOString(),
    location: 'Apapa-Oshodi Expressway, Lagos',
    driver: {
      id: 'drv-002',
      name: 'Blessing Okafor',
      safety_score_baseline: 71,
      incidents_last_30_days: 5,
      improvement_trend: 'stable',
    },
    vehicle: {
      id: 'JMG-0017',
      type: 'tanker',
      last_maintenance: 'January 10, 2025',
    },
    environment: {
      weather: 'Clear',
      traffic_density: 'moderate',
      road_type: 'urban',
    },
    analysis: {
      severity: 'YELLOW',
      severity_reason: 'Speeding 24 km/h over limit is an isolated incident from a stable-trend driver — coaching is the appropriate response.',
      root_cause: 'A 24 km/h overspeed represents a meaningful violation of the urban speed limit, indicating the driver was not actively monitoring speed in a zone that requires heightened compliance. In isolation, this event sits against a stable trend and a score of 71, suggesting a momentary lapse in attentiveness rather than a chronic unsafe driving pattern. Clear weather and moderate traffic removed environmental complexity, making this a behavioural rather than situational incident and therefore responsive to standard coaching intervention.',
      industry_reference: 'FMCSA BASIC Category 1 speed violations require documentation at first offence; repeat violations within 14 days elevate to formal review under carrier safety management protocols. FRSC Speed Monitoring Guidelines set the urban corridor threshold at 80 km/h on the Apapa-Oshodi Expressway; this incident places the vehicle at approximately 104 km/h.',
      coaching_recommendation: 'Document the event and conduct a brief coaching conversation before the driver\'s next shift, reinforcing speed limit awareness in urban corridors. No route restriction is warranted at this stage. A second speeding event within any 14-day window should automatically trigger a formal review with the fleet safety officer.',
      ops_flag: false,
      ops_flag_reason: '',
    },
  },
  {
    id: 'inc-003',
    type: 'excessive_idling',
    magnitude: '22 min idle',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    location: 'Apapa Port Gate 3, Lagos',
    driver: {
      id: 'drv-003',
      name: 'Kelechi Nwosu',
      safety_score_baseline: 88,
      incidents_last_30_days: 2,
      improvement_trend: 'improving',
    },
    vehicle: {
      id: 'JMG-0033',
      type: 'truck',
      last_maintenance: 'January 20, 2025',
    },
    environment: {
      weather: 'Partly Cloudy',
      traffic_density: 'heavy',
      road_type: 'urban',
    },
    analysis: {
      severity: 'GREEN',
      severity_reason: 'Port gate idling is a known operational constraint — contextually appropriate for this high-performing driver.',
      root_cause: 'Apapa Port Gate 3 is a documented bottleneck with average queue wait times of 15–25 minutes, meaning this idle event falls within the expected operational range rather than representing discretionary driver behaviour. Kelechi Nwosu\'s safety score of 88 and improving trend confirm this is a high-performing driver whose behaviour does not raise concern. The primary fleet exposure here is fuel efficiency and engine wear from idling, not safety risk — the issue sits with scheduling and gate access optimisation, not driver conduct.',
      industry_reference: 'FRSC RTSSS (Road Transport Safety Standards Scheme) idle reduction policies recommend engine-off protocols during port queues exceeding 10 minutes where safe to do so. FMCSA HOS idle documentation guidelines require logging of engine-on idle periods exceeding 5 minutes as part of fuel efficiency tracking under ELD mandates.',
      coaching_recommendation: 'No driver action required — Kelechi Nwosu performed within expected parameters given the operational context. Escalate to operations team for scheduling review and exploration of pre-clearance or priority gate access options. Publish a fleet-wide idle policy reminder clarifying the engine-off protocol for stationary queues exceeding 10 minutes.',
      ops_flag: false,
      ops_flag_reason: '',
    },
  },
];

export function useSafeIQ() {
  const [notifications, setNotifications] = useState<SafetyNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<SafetyNotification | null>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    MOCK_INCIDENTS.forEach((incident, index) => {
      const delay = index * 2500;
      const t = setTimeout(() => {
        const notification: SafetyNotification = { ...incident, analysisLoading: false, eventCount: 1 };
        setNotifications(prev => [notification, ...prev]);
      }, delay);
      timers.push(t);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    setSelectedNotification(prev => (prev?.id === id ? null : prev));
  }, []);

  const openDetail = useCallback((n: SafetyNotification) => {
    setSelectedNotification(n);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedNotification(null);
  }, []);

  return { notifications, dismiss, selectedNotification, openDetail, closeDetail };
}
