# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-11-21T07:51:15.156Z

- **flights**: ok — 5602 aircraft from OpenSky Network (worldwide, API client), 4842 with a known type, 437 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, weather, gps-ops, geo, starlink
- **news**: ok — protest 0, science 0, top 202 places via event export
- **fires**: ok — 2042 hotspots from VIIRS NOAA-20 (FIRMS area API), 67 KB
- **ships**: ok — 12141 vessels (4550 reports in 60 s), 789 KB
- **air**: failed — ENOENT: no such file or directory, open '/home/runner/work/global-intelligence-atlas/global-intelligence-atlas/site/app/data/cities.json'
- **nws**: ok — 365 of 389 alerts with an outline
- **lightning**: ok — 46 KB image for 2026-11-21T07:30:00.000Z
- **nhc**: ok — 0 active storms, 0 with a cone
- **perimeters**: ok — 57 fire outlines, 275 KB
- **airspace**: ok — 569 prohibited and restricted areas, 306 KB
- **gnss**: ok — 266 cells from 3034 aircraft in 16 regions, 7 with poor GPS

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news), Open-Meteo / CAMS (air quality), US National Weather Service (weather warnings), NOAA nowCOAST (lightning density), NHC (hurricane forecasts), NIFC WFIGS (fire perimeters), FAA (special use airspace), adsb.lol (GPS integrity). See docs/REFERENCES.md on main for licences.
