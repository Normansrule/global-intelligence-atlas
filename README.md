# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-11-14T11:03:03.848Z

- **flights**: ok — 6536 aircraft from OpenSky Network (worldwide, API client), 5651 with a known type, 506 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, weather, gps-ops, geo, starlink
- **news**: ok — protest 3, science 4, climate 10 places via event export
- **fires**: ok — 10206 hotspots from VIIRS NOAA-20 (FIRMS area API), 335 KB
- **ships**: ok — 13252 vessels (4443 reports in 60 s), 861 KB
- **air**: failed — ENOENT: no such file or directory, open '/home/runner/work/global-intelligence-atlas/global-intelligence-atlas/site/app/data/cities.json'
- **nws**: ok — 174 of 462 alerts with an outline

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news), Open-Meteo / CAMS (air quality), US National Weather Service (weather warnings). See docs/REFERENCES.md on main for licences.
