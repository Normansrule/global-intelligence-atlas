# Global Intelligence Atlas live-data

Machine-written snapshots for https://normansrule.github.io/global-intelligence-atlas/app/ — rebuilt every ~4 minutes by `.github/workflows/live.yml` on the main branch. Nothing here is edited by hand; each run replaces the whole branch.

Last run: 2026-11-07T10:04:37.635Z

- **flights**: ok — 5971 aircraft from OpenSky Network (worldwide, API client), 5153 with a known type, 462 KB
- **gdacs**: ok — 100 events
- **launches**: ok — upcoming + previous
- **tle**: ok — stations, visual, starlink
- **news**: ok — protest 4, science 5, climate 6 places via event export
- **fires**: ok — 12932 hotspots from VIIRS NOAA-20 (FIRMS area API), 429 KB
- **ships**: ok — 14322 vessels (5601 reports in 60 s), 929 KB

Data: OpenSky Network / airplanes.live / adsb.lol (flights), NASA FIRMS (fire hotspots), AISStream (ships), The Space Devs (launches), GDACS (disaster alerts), CelesTrak (orbits), The GDELT Project (news). See docs/REFERENCES.md on main for licences.
