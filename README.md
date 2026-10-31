# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-10-31T21:05:35.327Z

- **flights**: ok — 9488 aircraft from OpenSky Network (worldwide, API client), 8296 with a known type, 739 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, weather, gps-ops, geo, starlink
- **news**: ok — top 96, disaster 0, conflict 26 places via event export
- **fires**: ok — 42540 hotspots from VIIRS NOAA-20 (FIRMS area API), 1388 KB
- **ships**: ok — 14475 vessels (6152 reports in 60 s), 940 KB

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news). See docs/REFERENCES.md on main for licences.
