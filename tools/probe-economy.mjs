// temporary: print the shape of three economy endpoints (removed before merge)
const show = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'global-intelligence-atlas (github.com/Normansrule/global-intelligence-atlas)', Accept: 'application/json, text/csv, */*' }, signal: AbortSignal.timeout(60000) }); const t = await r.text(); console.log(`\n### ${u}\nHTTP ${r.status} ${r.headers.get('content-type')} ${t.length} bytes\n${t.slice(0, 900)}`); } catch (e) { console.log(`\n### ${u}\nERR ${e.message} ${e.cause?.code ?? ''}`); } };
for (const u of [
  'https://api.census.gov/data/2024/acs/acs5?get=NAME,B25077_001E,B25064_001E&for=county:*',
  'https://api.census.gov/data/2023/acs/acs5?get=NAME,B25077_001E&for=state:06',
  'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/all?startPeriod=2020-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels',
  'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/.Q..HPI+RHP?startPeriod=2020-Q1&format=csvfile',
  'https://sdmx.oecd.org/public/rest/dataflow/OECD.ECO.MPD/DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES/latest',
  'https://api.climatetrace.org/v6/assets?subsectors=iron-and-steel&limit=2',
  'https://api.climatetrace.org/v6/assets?sectors=manufacturing&limit=2',
  'https://api.climatetrace.org/v6/definitions/subsectors',
]) await show(u);
