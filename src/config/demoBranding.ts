/**
 * TEMP DEMO BRANDING KILL-SWITCH
 *
 * Enable locally only via `.env.local` (gitignored):
 *   VITE_DEMO_BRANDING=true
 *
 * Committed default is OFF (env unset / not "true").
 * Full restore map: docs/DEMO-BRANDING-RESTORE.md
 */
export const DEMO_BRANDING = import.meta.env.VITE_DEMO_BRANDING === 'true';

export const DEMO = {
  productName: 'Fleet Intelligence',
  clientName: 'Demo Fleet',
  logoSrc: null as string | null,
  logoAlt: 'Fleet',
  reportTitle: 'Fleet Event Report',
};

/** Stable 0-based index from any string. */
export function stableIndex(input: string, mod: number): number {
  let h = 0;
  const s = String(input || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

/**
 * Plausible Nigerian / West-African style mock full names (generated — not real people).
 * Same real name always maps to the same mock.
 */
const MOCK_DRIVER_NAMES = [
  'Chinedu Okafor', 'Amina Bello', 'Emeka Nwosu', 'Fatima Yusuf', 'Tunde Adeyemi',
  'Ngozi Eze', 'Ibrahim Musa', 'Blessing Okoro', 'Segun Balogun', 'Hauwa Abubakar',
  'Kelechi Obi', 'Zainab Mohammed', 'Olumide Adebayo', 'Chioma Nwankwo', 'Yusuf Hassan',
  'Adaeze Okonkwo', 'Babatunde Ojo', 'Maryam Suleiman', 'Ifeanyi Ugwu', 'Rashida Lawal',
  'Chukwuma Diala', 'Funke Ajayi', 'Abdullahi Garba', 'Nneka Ibe', 'Kunle Fashola',
  'Safiya Danjuma', 'Obinna Chukwu', 'Grace Akinola', 'Mustapha Bello', 'Amaka Onyeka',
  'Femi Oladipo', 'Halima Usman', 'Chisom Anya', 'Suleiman Audu', 'Yetunde Bakare',
  'Godwin Etim', 'Aisha Dikko', 'Uche Nnamdi', 'Bolaji Adekunle', 'Rukayat Aliyu',
  'Patrick Okeke', 'Jumoke Solanke', 'Haruna Ibrahim', 'Chinyere Mba', 'Tope Ogunleye',
  'Nafisa Abdulkadir', 'Victor Emeka', 'Latifat Owolabi', 'Daniel Okoro', 'Esther Nwachukwu',
  'Ahmed Tanko', 'Precious Udo', 'Samuel Afolabi', 'Deborah Ekanem', 'Michael Okafor',
  'Ruth Abiodun', 'Joseph Eze', 'Patience Okon', 'Isaac Nwosu', 'Joy Adeniyi',
  'Emmanuel Bassey', 'Comfort Okafor', 'Peter Ali', 'Faith Okeke', 'John Musa',
  'Mercy Adewale', 'David Okonkwo', 'Peace Nwankwo', 'James Yusuf', 'Hope Adebisi',
  'Anthony Eze', 'Gloria Bello', 'Francis Obi', 'Helen Okoro', 'Stephen Adeyemi',
  'Victoria Hassan', 'Paul Nwosu', 'Janet Musa', 'Mark Okafor', 'Sarah Eze',
  'Andrew Balogun', 'Rebecca Yusuf', 'Philip Okonkwo', 'Lydia Adebayo', 'George Nwankwo',
  'Martha Bello', 'Henry Ojo', 'Elizabeth Suleiman', 'Richard Ugwu', 'Agnes Lawal',
  'Timothy Diala', 'Rose Ajayi', 'Caleb Garba', 'Sylvia Ibe', 'Nathan Fashola',
  'Irene Danjuma', 'Oscar Chukwu', 'Winnie Akinola', 'Felix Bello', 'Cynthia Onyeka',
];

const MOCK_NAME_SET = new Set(MOCK_DRIVER_NAMES);

/** Real driver name → stable realistic mock (idempotent if already a mock). */
export function demoDriverLabel(realName: string): string {
  const t = String(realName || '').trim();
  if (!t) return t;
  if (MOCK_NAME_SET.has(t)) return t;
  return MOCK_DRIVER_NAMES[stableIndex(t, MOCK_DRIVER_NAMES.length)];
}

/** Scrub phone to a fake +234 mobile (deterministic). */
export function demoPhoneLabel(phone?: string | null): string {
  const raw = String(phone || '').trim();
  if (!raw || raw === 'N/A' || raw.toLowerCase() === 'null') return 'N/A';
  const n = stableIndex(raw, 90_000_000) + 10_000_000;
  const s = String(n).padStart(8, '0');
  return `+234 80${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5)}`;
}

/** Scrub HBM / Lafarge brand IP and soften place/zone/transporter strings for camera. */
export function demoPlaceLabel(value: string): string {
  let s = String(value || '');
  if (!s.trim()) return s;
  s = s
    .replace(/hbm\s*nigeria/gi, 'Demo Fleet')
    .replace(/\bhbm\b/gi, 'Demo')
    .replace(/lafarge\s*nigeria/gi, 'Demo Fleet')
    .replace(/\blafarge\b/gi, 'Demo')
    .replace(/\blh\b/gi, 'Fleet');
  if (/\d/.test(s) && /(street|road|ave|close|estate|lagos|abuja|ibadan)/i.test(s)) {
    return `Area ${String(stableIndex(s, 40) + 1).padStart(2, '0')}`;
  }
  return s.trim();
}
