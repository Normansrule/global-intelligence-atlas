// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Public Land Survey System (PLSS) in California.
// California's pesticide use records (and much other farm data) are located by PLSS section: a one-mile square
// numbered inside a six-mile township, counted north or south of a base line and east or west of a principal
// meridian. California has three: Humboldt (H), Mount Diablo (M) and San Bernardino (S). This module turns
// meridian / township / range / section into the approximate centre of the section by laying out the ideal grid
// from the meridian's initial point. Real surveys drift (correction lines, old Spanish and Mexican land grants),
// so a position can be off by a kilometre or two; that is fine on a globe, and the cards say so.
// Used by tools/fetch-regional.mjs (to place sections) and the Pesticide use layer (to label them).

/** Initial points of California's principal meridians (Bureau of Land Management), in degrees. */
export const MERIDIANS = {
  H: { name: 'Humboldt', lat: 40 + 25 / 60 + 2 / 3600, lng: -(124 + 7 / 60 + 10 / 3600) },
  M: { name: 'Mount Diablo', lat: 37 + 52 / 60 + 54 / 3600, lng: -(121 + 54 / 60 + 47 / 3600) },
  S: { name: 'San Bernardino', lat: 34 + 7 / 60 + 13 / 3600, lng: -(116 + 55 / 60 + 48 / 3600) },
};
const MI_PER_DEG_LAT = 69.055;
const MI_PER_DEG_LNG_EQ = 69.172;

/** Column (0 = west) and row (0 = north) of a section (1–36) in its township: sections snake from the north-east corner. */
export function sectionCell(section) {
  const s = Number(section); if (!(s >= 1 && s <= 36)) return null;
  const row = Math.floor((s - 1) / 6); const i = (s - 1) % 6;
  return { col: row % 2 === 0 ? 5 - i : i, row };
}

/**
 * Approximate centre of a section. township and range are numbers (1, 2, …); tdir is 'N' or 'S', rdir 'E' or 'W'.
 * Returns { lat, lng } or null when the input is not a valid California section.
 */
export function sectionCentre(meridian, township, tdir, range, rdir, section) {
  const m = MERIDIANS[String(meridian).toUpperCase()]; const cell = sectionCell(section);
  const t = Number(township); const r = Number(range); const td = String(tdir).toUpperCase(); const rd = String(rdir).toUpperCase();
  if (!m || !cell || !(t >= 1 && t <= 99) || !(r >= 1 && r <= 99) || !'NS'.includes(td) || !'EW'.includes(rd) || !td || !rd) return null;
  const southMi = td === 'N' ? (t - 1) * 6 : -t * 6; // township's south edge, miles north of the base line
  const westMi = rd === 'E' ? (r - 1) * 6 : -r * 6; // range's west edge, miles east of the meridian
  const north = southMi + (5 - cell.row) + 0.5; const east = westMi + cell.col + 0.5;
  const lat = m.lat + north / MI_PER_DEG_LAT;
  const lng = m.lng + east / (MI_PER_DEG_LNG_EQ * Math.cos(((m.lat + lat) / 2) * Math.PI / 180));
  return { lat, lng };
}

/** "Mount Diablo T8N R4E section 12" */
export function sectionLabel(meridian, township, tdir, range, rdir, section) {
  const m = MERIDIANS[String(meridian).toUpperCase()];
  return `${m ? m.name : meridian} T${Number(township)}${String(tdir).toUpperCase()} R${Number(range)}${String(rdir).toUpperCase()} section ${Number(section)}`;
}

/** Splits a compact key "M08N04E12" (meridian, township, direction, range, direction, section) into its parts. */
export function parseKey(k) {
  const m = /^([HMS])(\d{1,2})([NS])(\d{1,2})([EW])(\d{1,2})$/i.exec(String(k ?? ''));
  return m ? { meridian: m[1].toUpperCase(), township: +m[2], tdir: m[3].toUpperCase(), range: +m[4], rdir: m[5].toUpperCase(), section: +m[6] } : null;
}
export const makeKey = (meridian, township, tdir, range, rdir, section) => `${String(meridian).toUpperCase()}${String(Number(township)).padStart(2, '0')}${String(tdir).toUpperCase()}${String(Number(range)).padStart(2, '0')}${String(rdir).toUpperCase()}${String(Number(section)).padStart(2, '0')}`;
