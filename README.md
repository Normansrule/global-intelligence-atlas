# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-11-28T19:20:12.131Z

- **flights**: ok — 11250 aircraft from OpenSky Network (worldwide, API client), 9838 with a known type, 883 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, weather, gps-ops, geo, starlink
- **news**: ok — protest 3, science 2, top 106 places via event export
- **fires**: ok — 32793 hotspots from VIIRS NOAA-20 (FIRMS area API), 1054 KB
- **spread**: ok — 150 fires from 364573 hotspots (VIIRS NOAA-20, global 7 days), 1165 KB
- **ships**: ok — 7499 vessels (1635 reports in 60 s), 487 KB
- **air**: failed — ENOENT: no such file or directory, open '/home/runner/work/global-intelligence-atlas/global-intelligence-atlas/site/app/data/cities.json'
- **nws**: ok — 105 of 397 alerts with an outline
- **lightning**: ok — 55 KB image for 2026-11-28T19:00:00.000Z
- **nhc**: ok — 0 active storms, 0 with a cone
- **perimeters**: ok — 27 fire outlines, 216 KB
- **airspace**: ok — 569 prohibited and restricted areas, 306 KB
- **gnss**: ok — 247 cells from 3170 aircraft in 14 regions, 8 with poor GPS

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news), Open-Meteo / CAMS (air quality), US National Weather Service (weather warnings), NOAA nowCOAST (lightning density), NHC (hurricane forecasts), NIFC WFIGS (fire perimeters), FAA (special use airspace), adsb.lol (GPS integrity). See docs/REFERENCES.md on main for licences.
