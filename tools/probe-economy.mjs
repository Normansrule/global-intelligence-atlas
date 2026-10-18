// temporary: print the shape of economy endpoints (removed before merge)
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'global-intelligence-atlas (github.com/Normansrule/global-intelligence-atlas)', Accept: 'application/json, text/csv, */*' }, signal: AbortSignal.timeout(60000) }); return [r.status, await r.text()]; };
const show = async (u, f = (t) => t.slice(0, 700)) => { try { const [s, t] = await get(u); console.log(`\n### ${u}\nHTTP ${s} ${t.length} bytes\n${f(t)}`); } catch (e) { console.log(`\n### ${u}\nERR ${e.message}`); } };
const asset = (t) => { const j = JSON.parse(t); const a = j.assets?.[0] ?? {}; return `count=${j.assets?.length} keys=${Object.keys(a).join(',')} Centroid=${JSON.stringify(a.Centroid)} Sector=${a.Sector} Name=${a.Name} sectors=${[...new Set((j.assets ?? []).map((x) => x.Sector))].join(',')}`; };
await show('https://api.climatetrace.org/v6/assets?subsectors=cement&limit=50', asset);
await show('https://api.climatetrace.org/v6/assets?sectors=cement&limit=50', asset);
await show('https://api.climatetrace.org/v6/assets?subsectors=iron-and-steel&limit=1000&offset=1000', asset);
await show('https://api.climatetrace.org/v6/assets?subsectors=oil-and-gas-refining&limit=50', asset);
await show('https://api.climatetrace.org/v6/assets?subsectors=petrochemical-steam-cracking&limit=50', asset);
for (const u of [
  'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_RHPI_TARGET@DF_RHPI_TARGET,/all?startPeriod=2020-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels',
  'https://sdmx.oecd.org/public/rest/dataflow/all/all/latest?detail=allstubs',
]) await show(u, (t) => (/allstubs/.test(u) ? t.split('\n').filter((l) => /house|hous|property|RHPI|HPI/i.test(l)).slice(0, 20).join('\n') : t.slice(0, 900)));
