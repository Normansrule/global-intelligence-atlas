# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-10-24T14:07:30.370Z

- **flights**: ok — 11827 aircraft from OpenSky Network (worldwide, API client), 10306 with a known type, 917 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, weather, gps-ops, geo, starlink
- **news**: ok — top 225, disaster 0, conflict 32 places via event export
- **fires**: ok — 26848 hotspots from VIIRS NOAA-20 (FIRMS area API), 874 KB
- **ships**: ok — 16392 vessels (6623 reports in 60 s), 1072 KB

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news). See docs/REFERENCES.md on main for licences.
