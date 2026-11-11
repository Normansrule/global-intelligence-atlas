// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: what a flight tracker knows about a plane from its broadcast alone.
// An aircraft broadcasts only its 24-bit ICAO address and a callsign (BAW117). Offline tables built from Virtual
// Radar Server's standing data (public domain, tools/build-flightdb.py) turn those into the airline and flight
// number (British Airways BA 117), the scheduled route (London Heathrow to New York JFK), the full model name from
// the ICAO type code (Boeing 777-300ER) and the country the aircraft is registered in (from its address block, which
// also flags military blocks). Nothing here needs a network call to a flight tracker, so it works on the website.
import { getLocal } from './feeds.js';

const BASE = 'data/flightdb/';
let tables = null;
/** Load the small tables once (about 600 kB, cached by the browser). */
export function loadFlightDb() {
  tables ??= Promise.all(['airlines', 'types', 'blocks', 'countries', 'airports'].map((n) => getLocal(`${BASE}${n}.json`).catch(() => null)))
    .then(([airlines, types, blocks, countries, airports]) => {
      const byIata = {}; for (const [icao, [, iata]] of Object.entries(airlines ?? {})) if (iata && !byIata[iata]) byIata[iata] = icao;
      T = { airlines: airlines ?? {}, byIata, types: types ?? {}, blocks: blocks ?? [], countries: countries ?? {}, airports: airports?.rows ?? [] };
      return T;
    });
  return tables;
}
let T = null; // the loaded tables; the lookups below return null until they arrive

// Typical figures from the manufacturers' published specifications, for the airliners seen most often.
// seats: a typical two-class layout (airlines vary) · range: with a full passenger load · first: first flight
export const SPECS = {
  A318: { name: 'Airbus A318', seats: '107–132', range: 5750, length: 31.4, span: 34.1, first: 2002 },
  A319: { name: 'Airbus A319', seats: '124–156', range: 6850, length: 33.8, span: 34.1, first: 1995 },
  A320: { name: 'Airbus A320', seats: '150–180', range: 6150, length: 37.6, span: 34.1, first: 1987 },
  A321: { name: 'Airbus A321', seats: '185–220', range: 5950, length: 44.5, span: 34.1, first: 1993 },
  A19N: { name: 'Airbus A319neo', seats: '120–150', range: 6850, length: 33.8, span: 35.8, first: 2017 },
  A20N: { name: 'Airbus A320neo', seats: '150–180', range: 6300, length: 37.6, span: 35.8, first: 2014 },
  A21N: { name: 'Airbus A321neo', seats: '180–220', range: 7400, length: 44.5, span: 35.8, first: 2016 },
  BCS1: { name: 'Airbus A220-100', seats: '100–120', range: 6300, length: 35.0, span: 35.1, first: 2013 },
  BCS3: { name: 'Airbus A220-300', seats: '120–150', range: 6300, length: 38.7, span: 35.1, first: 2015 },
  A332: { name: 'Airbus A330-200', seats: '220–260', range: 13450, length: 58.8, span: 60.3, first: 1997 },
  A333: { name: 'Airbus A330-300', seats: '250–290', range: 11750, length: 63.7, span: 60.3, first: 1992 },
  A339: { name: 'Airbus A330-900', seats: '260–300', range: 13300, length: 63.7, span: 64.0, first: 2017 },
  A359: { name: 'Airbus A350-900', seats: '300–350', range: 15000, length: 66.8, span: 64.8, first: 2013 },
  A35K: { name: 'Airbus A350-1000', seats: '350–410', range: 16100, length: 73.8, span: 64.8, first: 2016 },
  A388: { name: 'Airbus A380', seats: '470–575', range: 15000, length: 72.7, span: 79.8, first: 2005 },
  B712: { name: 'Boeing 717', seats: '106', range: 3800, length: 37.8, span: 28.4, first: 1998 },
  B737: { name: 'Boeing 737-700', seats: '126–149', range: 6370, length: 33.6, span: 35.8, first: 1997 },
  B738: { name: 'Boeing 737-800', seats: '162–189', range: 5400, length: 39.5, span: 35.8, first: 1997 },
  B739: { name: 'Boeing 737-900', seats: '177–215', range: 5000, length: 42.1, span: 35.8, first: 2000 },
  B38M: { name: 'Boeing 737 MAX 8', seats: '162–189', range: 6570, length: 39.5, span: 35.9, first: 2016 },
  B39M: { name: 'Boeing 737 MAX 9', seats: '178–193', range: 6570, length: 42.2, span: 35.9, first: 2017 },
  B744: { name: 'Boeing 747-400', seats: '416', range: 13450, length: 70.6, span: 64.4, first: 1988 },
  B748: { name: 'Boeing 747-8', seats: '410', range: 14320, length: 76.3, span: 68.4, first: 2010 },
  B752: { name: 'Boeing 757-200', seats: '200', range: 7250, length: 47.3, span: 38.1, first: 1982 },
  B763: { name: 'Boeing 767-300', seats: '218–269', range: 11070, length: 54.9, span: 47.6, first: 1986 },
  B772: { name: 'Boeing 777-200', seats: '313', range: 13080, length: 63.7, span: 60.9, first: 1994 },
  B77L: { name: 'Boeing 777-200LR', seats: '317', range: 15840, length: 63.7, span: 64.8, first: 2005 },
  B77W: { name: 'Boeing 777-300ER', seats: '396', range: 13650, length: 73.9, span: 64.8, first: 2003 },
  B788: { name: 'Boeing 787-8 Dreamliner', seats: '248', range: 13530, length: 56.7, span: 60.1, first: 2009 },
  B789: { name: 'Boeing 787-9 Dreamliner', seats: '296', range: 14010, length: 62.8, span: 60.1, first: 2013 },
  B78X: { name: 'Boeing 787-10 Dreamliner', seats: '336', range: 11730, length: 68.3, span: 60.1, first: 2017 },
  E170: { name: 'Embraer 170', seats: '70–78', range: 3900, length: 29.9, span: 26.0, first: 2002 },
  E75L: { name: 'Embraer 175', seats: '76–88', range: 4000, length: 31.7, span: 26.0, first: 2003 },
  E75S: { name: 'Embraer 175', seats: '76–88', range: 4000, length: 31.7, span: 26.0, first: 2003 },
  E190: { name: 'Embraer 190', seats: '96–114', range: 4500, length: 36.2, span: 28.7, first: 2004 },
  E195: { name: 'Embraer 195', seats: '100–124', range: 4250, length: 38.7, span: 28.7, first: 2004 },
  E290: { name: 'Embraer 190-E2', seats: '97–114', range: 5300, length: 36.2, span: 33.7, first: 2016 },
  E295: { name: 'Embraer 195-E2', seats: '120–146', range: 4800, length: 41.5, span: 35.1, first: 2017 },
  CRJ7: { name: 'Bombardier CRJ700', seats: '66–78', range: 3000, length: 32.5, span: 23.2, first: 1999 },
  CRJ9: { name: 'Bombardier CRJ900', seats: '76–90', range: 2900, length: 36.2, span: 24.9, first: 2001 },
  AT72: { name: 'ATR 72', seats: '68–78', range: 1400, length: 27.2, span: 27.1, first: 1988 },
  AT75: { name: 'ATR 72-500', seats: '68–74', range: 1500, length: 27.2, span: 27.1, first: 1996 },
  AT76: { name: 'ATR 72-600', seats: '68–78', range: 1400, length: 27.2, span: 27.1, first: 2009 },
  DH8D: { name: 'De Havilland Dash 8-400', seats: '68–90', range: 2000, length: 32.8, span: 28.4, first: 1998 },
  MD11: { name: 'McDonnell Douglas MD-11', seats: '298', range: 12455, length: 61.6, span: 51.7, first: 1990 },
  A343: { name: 'Airbus A340-300', seats: '250–290', range: 13500, length: 63.7, span: 60.3, first: 1992 },
  A346: { name: 'Airbus A340-600', seats: '320–380', range: 14450, length: 75.4, span: 63.5, first: 2001 },
  B762: { name: 'Boeing 767-200', seats: '181–224', range: 7200, length: 48.5, span: 47.6, first: 1981 },
  B764: { name: 'Boeing 767-400ER', seats: '245', range: 10415, length: 61.4, span: 51.9, first: 1999 },
  B753: { name: 'Boeing 757-300', seats: '243', range: 6295, length: 54.4, span: 38.1, first: 1998 },
  B77F: { name: 'Boeing 777 Freighter', seats: 'cargo', range: 9200, length: 63.7, span: 64.8, first: 2008 },
  B74F: { name: 'Boeing 747-400 Freighter', seats: 'cargo', range: 8230, length: 70.6, span: 64.4, first: 1993 },
  A306: { name: 'Airbus A300-600', seats: '247', range: 7500, length: 54.1, span: 44.8, first: 1983 },
  CRJ2: { name: 'Bombardier CRJ200', seats: '50', range: 3150, length: 26.8, span: 21.2, first: 1991 },
  E145: { name: 'Embraer ERJ 145', seats: '50', range: 2870, length: 29.9, span: 20.0, first: 1995 },
  AT45: { name: 'ATR 42-500', seats: '48', range: 1300, length: 22.7, span: 24.6, first: 1995 },
  DH8C: { name: 'De Havilland Canada Dash 8-300', seats: '50', range: 1700, length: 25.7, span: 27.4, first: 1987 },
  SF34: { name: 'Saab 340', seats: '34', range: 1700, length: 19.7, span: 21.4, first: 1983 },
  C130: { name: 'Lockheed C-130 Hercules', seats: 'military transport', range: 3800, length: 29.8, span: 40.4, first: 1954 },
  C30J: { name: 'Lockheed Martin C-130J Super Hercules', seats: 'military transport', range: 3300, length: 29.8, span: 40.4, first: 1996 },
  C17: { name: 'Boeing C-17 Globemaster III', seats: 'military transport', range: 4480, length: 53.0, span: 51.8, first: 1991 },
  A400: { name: 'Airbus A400M Atlas', seats: 'military transport', range: 3300, length: 45.1, span: 42.4, first: 2009 },
  K35R: { name: 'Boeing KC-135 Stratotanker', seats: 'air-to-air tanker', range: 2400, length: 41.5, span: 39.9, first: 1956 },
  GLF6: { name: 'Gulfstream G650', seats: '11–18', range: 12960, length: 30.4, span: 30.4, first: 2009 },
  GL7T: { name: 'Bombardier Global 7500', seats: '17–19', range: 14260, length: 33.8, span: 31.7, first: 2016 },
  CL35: { name: 'Bombardier Challenger 350', seats: '8–10', range: 5900, length: 20.9, span: 21.0, first: 2013 },
  C68A: { name: 'Cessna Citation Latitude', seats: '8–9', range: 5000, length: 18.97, span: 22.05, first: 2014 },
  E55P: { name: 'Embraer Phenom 300', seats: '6–10', range: 3650, length: 15.9, span: 16.2, first: 2008 },
  PC12: { name: 'Pilatus PC-12', seats: '6–9', range: 3400, length: 14.4, span: 16.3, first: 1991 },
  C208: { name: 'Cessna 208 Caravan', seats: '9–14', range: 1700, length: 11.5, span: 15.9, first: 1982 },
  C172: { name: 'Cessna 172 Skyhawk', seats: '4', range: 1185, length: 8.3, span: 11.0, first: 1955 },
  C919: { name: 'COMAC C919', seats: '158–168', range: 4075, length: 38.9, span: 35.8, first: 2017 },
};
const ENGINE = { J: 'jet', T: 'turboprop', P: 'piston', E: 'electric', R: 'rocket' };
const WAKE = { H: 'heavy (wide-body)', M: 'medium', L: 'light', 'L/M': 'light to medium', 'M/H': 'medium to heavy', J: 'super (A380)' };

/** "BAW117" -> { code: 'BAW', number: '117', airline: 'British Airways', iata: 'BA', flight: 'BA 117' } (or null). */
export function decodeCall(call) {
  const m = /^([A-Z]{3})(\d[A-Z0-9]{0,4})$/.exec((call ?? '').trim().toUpperCase()); if (!m || !T) return null;
  const al = T.airlines[m[1]]; if (!al) return null;
  const n = m[2].replace(/^0+(?=\d)/, '');
  return { code: m[1], number: m[2], airline: al[0], iata: al[1], flight: /^\d+[A-Z]?$/.test(n) ? `${al[1] || m[1]} ${n}` : null };
}
/** The full model and typical figures for an ICAO type designator (B77W). */
export function model(type) {
  if (!type || !T) return null;
  const t = T.types[type]; const s = SPECS[type];
  if (!t && !s) return null;
  const [maker, mdl, eng, wake, place] = t ?? [];
  const n = eng?.[0]; const kind = ENGINE[eng?.[1]];
  return { type, name: s?.name ?? [maker, mdl].filter(Boolean).join(' '), maker, engines: n && kind ? `${n === 'C' ? 'several' : n} ${kind} engine${n === '1' ? '' : 's'}` : null,
    engineCount: /^\d$/.test(n ?? '') ? +n : null, engineKind: eng?.[1] ?? null, aft: place === 'A', wake: WAKE[wake] ?? null, ...(s ?? {}) };
}
/** Where an aircraft is registered, from the block its 24-bit address was allocated in (and whether it is military). */
export function registeredIn(hex) {
  if (!hex || !T) return null;
  const v = parseInt(hex, 16); if (!Number.isFinite(v)) return null;
  for (const [a, b, cc, mil] of T.blocks) if (v >= a && v <= b) return { cc, country: T.countries[cc] ?? cc, military: !!mil };
  return null;
}
const airportOf = (i) => { const r = T.airports[i]; return r && { icao: r[0], iata: r[1], name: r[2], city: r[3], cc: r[4], lat: r[5], lng: r[6], country: T.countries[r[4]] ?? r[4] }; };
const routeFiles = new Map();
/** The route file of an airline; Windows-reserved names (CON, PRN, AUX, NUL, COM1–9, LPT1–9) carry a leading underscore. */
export const routeFile = (code) => `${/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(code) ? '_' : ''}${code}.json`;
/** The scheduled route for a callsign: a list of airports (two, or more for a multi-stop flight), or null. */
export async function scheduledRoute(call) {
  const d = decodeCall(call); if (!d) return null;
  if (!routeFiles.has(d.code)) routeFiles.set(d.code, getLocal(`${BASE}routes/${routeFile(d.code)}`).catch(() => null));
  const m = await routeFiles.get(d.code); if (!m) return null;
  const chain = m[d.number] ?? m[d.number.replace(/^0+(?=\d)/, '')]; if (!chain) return null;
  return chain.split('-').map((x) => airportOf(parseInt(x, 16))).filter(Boolean);
}
const fromFiles = new Map();
/** Every scheduled nonstop leg out of an airport (ICAO code), busiest first: { to, flights, airlines: [{ code, name, iata }] }. */
export async function routesFrom(icao) {
  await loadFlightDb(); if (!icao || !T) return null;
  const k = icao[0]; if (!fromFiles.has(k)) fromFiles.set(k, getLocal(`${BASE}from/${k}.json`).catch(() => null));
  const legs = (await fromFiles.get(k))?.[icao]; if (!legs) return null;
  return legs.map(([b, n, al]) => ({ to: airportOf(b), flights: n, airlines: al.split(' ').map((c) => ({ code: c, name: T.airlines[c]?.[0] ?? c, iata: T.airlines[c]?.[1] ?? '' })) })).filter((x) => x.to);
}
/** Airlines whose name or code starts with the query, for search. */
export function findAirlines(q, max = 3) {
  if (!T || q.length < 2) return [];
  const s = q.toLowerCase(); const out = [];
  for (const [icao, [name, iata]] of Object.entries(T.airlines)) {
    if (name.toLowerCase().startsWith(s) || icao.toLowerCase() === s || iata.toLowerCase() === s) out.push({ icao, name, iata });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => a.name.length - b.name.length).slice(0, max);
}
/** "BA117", "BA 117", "BAW117" or "G-STBA" -> what to match a live flight against. */
export function parseFlightQuery(q) {
  const s = q.trim().toUpperCase().replace(/\s+/g, '');
  let m = /^([A-Z]{3})(\d[A-Z0-9]{0,4})$/.exec(s); if (m && T?.airlines[m[1]]) return { call: s };
  m = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(s);
  if (m && T?.byIata[m[1]]) return { call: `${T.byIata[m[1]]}${m[2]}`, alt: `${T.byIata[m[1]]}${m[2].replace(/^0+/, '')}` };
  if (/^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/.test(s) && /\d|-/.test(s)) return { reg: s.replace('-', '') };
  return null;
}
