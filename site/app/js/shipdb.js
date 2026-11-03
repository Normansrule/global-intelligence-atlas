// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: what a ship's radio broadcast says about it.
// A vessel's Automatic Identification System (AIS) messages carry a 9-digit Maritime Mobile Service Identity (MMSI)
// and a 2-digit ship type. The first three digits of a ship's MMSI are its Maritime Identification Digits (MID),
// which the International Telecommunication Union (ITU) allocates to each flag state (ITU-R M.585), and the type code
// follows ITU-R M.1371 table 53. The MID table below is the ITU allocation as packaged by pyais (MIT licence).

// "201AL202AD..." : MID followed by the ISO 3166 two-letter country code
const MIDS = '201AL202AD203AT204PT205BE206BY207BG208VA209CY210CY211DE212CY213GE214MD215MT216AM218DE219DK220DK224ES225ES226FR227FR228FR229MT230FI231FO232GB233GB234GB235GB236GI237GR238HR239GR240GR241GR242MA243HU244NL245NL246NL247IT248MT249MT250IE251IS252LI253LU254MC255PT256MT257NO258NO259NO261PL262ME263PT264RO265SE266SE267SK268SM269CH270CZ271TR272UA273RU274MK275LV276EE277LT278SI279RS301AI303US304AG305AG306CW307AW308BS309BS310BM311BS312BZ314BB316CA319KY321CR323CU325DM327DO329GP330GD331GL332GT334HN336HT338US339JM341KN343LC345MX347MQ348MS350NI351PA352PA353PA354PA355PA356PA357PA358PR359SV361PM362TT364TC366US367US368US369US370PA371PA372PA373PA374PA375VC376VC377VC378VG379VI401AF403SA405BD408BH410BT412CN413CN414CN416TW417LK419IN422IR423AZ425IQ428IL431JP432JP434TM436KZ437UZ438JO440KR441KR443PS445KP447KW450LB451KG453MO455MV457MN459NP461OM463PK466QA468SY470AE471AE472TJ473YE475YE477HK478BA501AQ503AU506MM508BN510FM511PW512NZ514KH515KH516CX518CK520FJ523CC525ID529KI531LA533MY536MP538MH540NC542NU544NR546PF548PH553PG555PN557SB559AS561WS563SG564SG565SG566SG567TH570TO572TV574VN576VU577VU578WF601ZA603AO605DZ607TF608IO609BI610BJ611BW612CF613CM615CG616KM617CV618AQ619CI620KM621DJ622EG624ET625ER626GA627GH629GM630GW631GQ632GN633BF634KE635AQ636LR637LR642LY644LS645MU647MG649ML650MZ654MR655MW656NE657NG659NA660RE661RW662SD663SN664SC665SH666SO667SL668ST669SZ670TD671TG672TN674TZ675UG676CD677TZ678ZM679ZW701AR710BR720BO725CL730CO735EC740UK745GF750GY755PY760PE765SR770UY775VE';
let mid = null;
const regionName = (() => { try { const n = new Intl.DisplayNames(['en'], { type: 'region' }); return (cc) => n.of(cc); } catch { return (cc) => cc; } })();
/** ISO country code -> English name ("PA" -> "Panama"). */
export const countryName = (cc) => { try { return regionName(cc) ?? cc; } catch { return cc; } };

/** What kind of station an MMSI belongs to, and the flag (country) it is registered under. */
export function mmsiInfo(mmsi) {
  if (!mid) { mid = new Map(); for (let i = 0; i < MIDS.length; i += 5) mid.set(+MIDS.slice(i, i + 3), MIDS.slice(i + 3, i + 5)); }
  const s = String(mmsi ?? '').padStart(9, '0'); if (!/^\d{9}$/.test(s)) return null;
  let kind = 'Ship'; let m = s.slice(0, 3);
  if (s.startsWith('00')) { kind = 'Coast station'; m = s.slice(2, 5); }
  else if (s.startsWith('0')) { kind = 'Group of ships'; m = s.slice(1, 4); }
  else if (s.startsWith('111')) { kind = 'Search and rescue aircraft'; m = s.slice(3, 6); }
  else if (s.startsWith('970')) return { kind: 'Search and rescue transmitter (lifeboat beacon)' };
  else if (s.startsWith('972')) return { kind: 'Man-overboard beacon' };
  else if (s.startsWith('974')) return { kind: 'Emergency position-indicating radio beacon' };
  else if (s.startsWith('98')) { kind = 'Craft carried by a parent ship'; m = s.slice(2, 5); }
  else if (s.startsWith('99')) { kind = 'Aid to navigation (buoy, beacon or lighthouse)'; m = s.slice(2, 5); }
  else if (s.startsWith('8')) { kind = 'Handheld radio'; m = s.slice(1, 4); }
  const cc = mid.get(+m);
  return { kind, cc: cc ?? null, flag: cc ? countryName(cc) : null };
}

const HAZ = ['', 'dangerous goods, category A', 'dangerous goods, category B', 'dangerous goods, category C', 'dangerous goods, category D'];
const TENS = { 2: 'Wing-in-ground craft', 4: 'High-speed craft', 6: 'Passenger ship', 7: 'Cargo ship', 8: 'Tanker', 9: 'Other vessel' };
const SINGLE = { 30: 'Fishing vessel', 31: 'Towing vessel', 32: 'Towing vessel (tow over 200 m long or 25 m wide)', 33: 'Dredger or underwater works', 34: 'Diving support vessel', 35: 'Military vessel', 36: 'Sailing vessel', 37: 'Pleasure craft', 50: 'Pilot boat', 51: 'Search and rescue vessel', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution vessel', 55: 'Law enforcement vessel', 58: 'Medical transport', 59: 'Non-combatant ship (Geneva Conventions)' };
/** The ITU type code (70) as words ("Cargo ship"), with the hazardous-cargo category when one is declared. */
export function shipTypeName(t) {
  t = Number(t); if (!Number.isFinite(t) || t <= 0) return null;
  if (SINGLE[t]) return SINGLE[t];
  const base = TENS[Math.floor(t / 10)]; if (!base) return null;
  const h = HAZ[t % 10]; return h ? `${base}, ${h}` : base;
}
/** Broad kind for filtering: the same groups as the map symbols. */
export function shipKind(t) {
  t = Number(t);
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t === 30) return 'fishing';
  if (t === 31 || t === 32 || t === 52) return 'tug';
  if (t === 36 || t === 37) return 'leisure';
  return t > 0 ? 'other' : null;
}
export const KIND_LABEL = { cargo: 'cargo ships', tanker: 'tankers', passenger: 'passenger ships', fishing: 'fishing vessels', tug: 'tugs', leisure: 'sailing and pleasure boats', other: 'other vessels' };

/** Which Panama Canal locks the ship fits (Autoridad del Canal de Panamá limits: original locks 294.13 m long,
 *  32.31 m wide, 12.04 m draught; the 2016 Neopanamax locks 366 m, 51.25 m, 15.2 m). */
export function canalFit(len, beam, draught) {
  if (!len || !beam) return null;
  const ok = (L, B, D) => len <= L && beam <= B && (!draught || draught <= D);
  if (ok(294.13, 32.31, 12.04)) return 'Panamax: fits the original Panama Canal locks';
  if (ok(366, 51.25, 15.2)) return 'Neopanamax: fits only the newer, larger Panama Canal locks';
  return 'Too big for the Panama Canal';
}
/** AIS destinations are free text, often a UN/LOCODE ("NLRTM", "NL RTM"). Make the country part readable. */
export function niceDestination(d) {
  if (!d) return null;
  const s = String(d).trim().replace(/\s+/g, ' '); const parts = s.split(/\s*(?:>|=>|->)\s*/).filter(Boolean);
  const one = (p) => { const m = /^([A-Z]{2}) ?([A-Z2-9]{3})$/.exec(p); if (!m) return p; const n = countryName(m[1]); return n && n !== m[1] ? `${m[2]}, ${n}` : p; };
  return parts.length > 1 ? parts.map(one).join(' to ') : one(s);
}
