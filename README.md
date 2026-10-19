# Global Intelligence Atlas economy data

House prices, property sales, exports and heavy industry from openly licensed statistics, boiled down for the map, written monthly by `.github/workflows/economy.yml` on main (`tools/fetch-economy.mjs`); each run replaces the branch, and a source that fails keeps its previous file (see `status.json`).

- `houseprices/fhfa.json`: U.S. Federal Housing Finance Agency (FHFA) House Price Index by state and metropolitan area (public domain).
- `houseprices/ukhpi.json`: HM Land Registry UK House Price Index by local authority (Open Government Licence v3.0).
- `houseprices/eurostat.json`: Eurostat house price index by country (CC BY 4.0).
- `houseprices/oecd.json`: Organisation for Economic Co-operation and Development (OECD) house price indicators by country (CC BY 4.0).
- `acs/counties.json`: U.S. Census Bureau American Community Survey (ACS) median home value and rent by county (public domain).
- `sales/districts.json`: HM Land Registry Price Paid Data, sales in the last 12 months by postcode district (Open Government Licence v3.0; contains HM Land Registry data © Crown copyright and database right; no addresses are kept). Positions from Ordnance Survey Code-Point Open (contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; National Statistics data © Crown copyright and database right).
- `exports/countries.json`: CEPII BACI exports by country and product (Etalab Open Licence 2.0).
- `industry/assets.json`: Climate TRACE heavy-industry assets and emissions (CC BY 4.0).

See docs/REFERENCES.md on main for citations and terms.
