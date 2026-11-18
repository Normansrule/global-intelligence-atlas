# Assumptions and approximations

What the atlas assumes, simplifies or could not check, release by release, with the reason and where it shows. The sources themselves are in [REFERENCES.md](REFERENCES.md) (APA 7th edition) and `site/app/js/sources.js`; licences and changes to other people's work are in [NOTICE.md](../NOTICE.md), [`LICENSES/`](../LICENSES) and [`site/app/textures/space/CREDITS.md`](../site/app/textures/space/CREDITS.md).

How to read it: **Assumption** is something taken as true without checking it here. **Approximation** is a known simplification with its size of error. **Not verified** is something that could not be tested in the build environment. **Judgement** is a choice between sources or methods, with the reason.

Every release adds a section at the top. `tests/docs/check_release.py` fails if the current version has no section.

---

## v2.30: the Sun, the planets and their moons in depth

Each body's page in space gains six sections (`site/app/js/spacedetail.js`), worked out on the device from Astronomy Engine (Cross, 2023) and figures rounded from NASA's Planetary Fact Sheets (Williams, n.d.). Nothing new is fetched, so they open offline too.

- **Assumption:** gravity, escape speed, length of day and year, axial tilt, mean temperature, surface pressure and air composition are NASA's Planetary Fact Sheet values, rounded, typed in for this build. For the giant planets "surface" means the level where the pressure is 1 bar. Small moons and small worlds use published mean values; Bennu's gravity (about 6 µm/s²) varies a lot over its surface.
- **Approximation:** "a 50 cm jump goes" scales the height by Earth's gravity over the body's, as if gravity stayed the same all the way up. On worlds a few kilometres across this overstates the height; where the take-off speed of that jump (3.1 m/s) is above the escape speed, the page says you would leave for good.
- **Approximation:** how wide and bright the Sun looks uses the body's mean distance from the Sun (a moon uses its planet's), with brightness falling as the square of the distance; eccentric orbits (Mercury, Mars, Pluto) swing either side of it.
- **Approximation:** "sunrise to sunrise" for a moon locked to its planet is taken as its orbit round the planet, which differs from the true solar day by well under 1 % for every moon listed.
- **Approximation:** "getting there" is a Hohmann transfer (Curtis, 2020) between circular orbits in one plane at 1 AU and at the body's mean distance, from a 200 km circular Earth orbit. Real orbits are elliptical and tilted, and real missions use planetary swing-bys, so trip times and speeds are a textbook baseline; the page gives the real mission's time next to it. A moon's figures are for reaching its planet's distance.
- **Approximation:** the next launch window is the first date on which the planet leads (or trails) the Earth by the transfer's angle, using their real heliocentric longitudes from Astronomy Engine checked once a day. With real orbits, windows open a few weeks either side of it; for Mars this gives December 2026, which matches the late-2026 window.
- **Approximation:** rising, setting and altitude are for the point the globe was looking at when you flew out, at sea level with a flat horizon and standard refraction; moons of other planets use their planet's times, since they cannot be seen apart without a telescope. Opposition (outer planets), greatest elongation (Mercury and Venus) and the full Moon are the next ones after the atlas clock.
- **Judgement:** the spacecraft listed are highlights (first flyby, first orbiter, first landing, the latest and those on their way), not every mission. Missions still flying or on their way are written as such on 17 November 2026; dates of planned arrivals can slip.

---

## v2.29: markets, cloud regions and AI labs in depth

The three new pages (`site/app/js/econdetail.js`) are worked out in the browser from data the atlas already ships: World Monitor's financial centres, finance places, cloud regions, AI labs, tech headquarters and AI data centres, Natural Earth's populated places, and the browser's own copy of the IANA time zone database (IANA, n.d.). Nothing is fetched for them, so they open offline too.

Markets
- **Not verified:** each exchange's regular session (for example New York 09:30 to 16:00, London 08:00 to 16:30, Frankfurt 09:00 to 17:30, Tokyo 09:00 to 15:30 with lunch 11:30 to 12:30, Hong Kong 09:30 to 16:00 with lunch 12:00 to 13:00) is written from the exchanges' published hours as remembered for this build and not checked against each exchange's current rule book. Saudi Arabia, Qatar, Kuwait, Bahrain and Egypt trade Sunday to Thursday; Dubai and Abu Dhabi moved to Monday to Friday in 2022.
- **Approximation:** public holidays, half days, opening and closing auctions and after-hours trading are left out, so on a holiday the page says an exchange is open when it is not; the strip says so. CME Group is shown as Globex, nearly round the clock from Sunday evening to Friday afternoon in Chicago time with a daily one-hour break.
- **Approximation:** "opens in" and "closes in" are counted minute by minute in the place's own time with the offset from UTC taken at the moment the page opens; a countdown that crosses a daylight-saving change can be an hour off.
- **Judgement:** a place with no time zone of its own (a central bank, a financial centre, an exchange from Wikidata) borrows one from the atlas's tables, then from the nearest of about 50 big financial cities within 600 km; with none in reach the page shows no local time.
- **Judgement:** the trading-day strip draws 16 big exchanges chosen to cover every region, west to east, plus the open exchange if it is not among them. It is not a ranking.

Cloud regions and AI labs
- **Approximation:** a round trip is taken as twice the straight-line distance times 1.5 (for the route cables really take) divided by 204 km per millisecond, the speed of light in glass fibre with a refractive index of about 1.47. It is a floor: Singla et al. (2014) found real round trips are usually several times the straight-line, speed-of-light figure because of routes, routers and queues, and the page says real pings are higher. 10 ms comes out at about 680 km and 30 ms at about 2,040 km.
- **Approximation:** "people within reach" adds up the populations of Natural Earth's cities and towns inside each ring. It is a lower bound (villages and the countryside are left out) and ignores borders, oceans and where the cables actually land.
- **Judgement:** the 12 cities in "how fast it answers" are the biggest in the atlas's list spread over the continents, not a measure of where users are.
- **Assumption:** a region's availability zones, a lab's founding year, focus areas and publication count are World Monitor's figures as shipped, not checked against the providers or the labs.
- **Approximation:** "next door" uses straight lines: other providers' regions within 200 km, AI data centres within 500 km of a region, labs within 100 km and tech headquarters within 50 km of a lab.

---

## v2.28: conflict zones, watch regions and military bases in depth

The three new pages (`site/app/js/geodetail.js`) are worked out in the browser from data the atlas already ships: World Monitor's conflict zones, watch regions, military bases, nuclear plants, ports, pipelines, cables and chokepoints, Natural Earth's populated places, OurAirports and the atlas's country outlines. Nothing new is fetched, so the pages also work offline.

- **Judgement:** a conflict zone is the area World Monitor draws by hand. It is a rough outline of where fighting and its effects are, not a front line, a frontier or a count of events; the page says so. Areas, countries, people and sites are all measured against that outline.
- **Approximation:** areas use the spherical-excess formula on a sphere of radius 6,371.0088 km (Chamberlain & Duquette, 2007), the method d3-geo and Turf use; the error against the real ellipsoid is under about 0.5 %. "About the size of" picks the country whose area, from the atlas's own simplified outlines, is closest on a log scale; it reads "about the size of" within −15 % to +18 %, otherwise "about N times".
- **Approximation:** the countries a zone covers come from a grid of points every 0.1° to 1° (finer for smaller zones) tested against the atlas's country outlines; a share under one grid cell can be missed and is shown as "<1 %". Points at sea count towards the sea share, not a country.
- **Approximation:** "people inside" adds up the populations of the 2,533 cities and towns in Natural Earth's populated places that fall inside the outline. It is a lower bound (villages, the countryside and anyone displaced are not counted) and the populations are Natural Earth's, which are metropolitan estimates of varying date; the page says it is a lower bound.
- **Judgement:** "what is at stake" lists the atlas's nuclear power plants (research reactors left out), ports, chokepoints and cable landings inside the outline or within 100 km, the big airports (OurAirports "large") inside it, and pipelines with a drawn point inside it.
- **Approximation:** a watch region is a point in World Monitor's list with no outline, so its page uses a circle of 500 km around it. The distance to the nearest conflict zone is to the edge of the drawn outline, sampled every 10 km.
- **Judgement:** military bases come only from World Monitor's list of overseas and key home bases (226, from the ASIAR overseas bases dataset with later changes), so small, secret and many home bases are missing; the page says so. Closed bases are left out of counts. "United States and NATO" is one group in that list. "United Kingdoms" in the list is shown as "United Kingdom".
- **Approximation:** other powers' bases are counted within 1,000 km in a straight line, and the line to the nearest of each is drawn straight between the two points on the map. Days' sailing to the nearest chokepoint assume 15 knots and a base on the coast; for an inland base it is only a measure of distance.

---

## v2.27: spaceports and mines in depth

Both new pages (`site/app/js/sitedetail.js`) are worked out in the browser from data the atlas already ships: the spaceport list (World Monitor's, or Wikidata's with open data on), World Monitor's mines, processing plants, ports and commodity hubs, the Critical minerals list, the atlas's country outlines and, when it is on, the Rocket launches layer. Nothing new is fetched, so the pages also work offline.

Spaceports
- **Approximation:** Earth's surface speed at the equator is taken as 465.1 m/s (2π × 6,378.137 km, the equatorial radius in the IERS conventions, divided by one sidereal day of 86,164.1 s), and the speed a due-east launch gains as 465.1 × cos(latitude). Low orbit is "about 7,800 m/s".
- **Approximation:** orbit tilt from launch latitude φ and bearing A uses cos i = cos φ · sin A (Curtis, 2020), for a launch straight into orbit on a spherical Earth, ignoring its rotation; the extra eastward speed slightly changes the real bearing for a given tilt (by under a degree or two).
- **Approximation:** the cost of flattening an orbit for the geostationary belt is 2 · 3.075 km/s · sin(i/2), as if done on its own at that height. It is an upper bound: real missions combine it with the circularising burn and pay less (Kourou launches pay roughly 1.5 km/s for the whole manoeuvre, Cape Canaveral roughly 1.8 km/s), and the page says so.
- **Approximation:** "where rockets can fly" checks every 5° of the compass at points every 30 km from 30 to 900 km out against the atlas's country outlines; a direction is sea-safe when none of those points falls on land. This stands in for a range-safety corridor. Real ranges also weigh small islands missing from the outlines, shipping lanes, air routes, debris zones and their own rules, and some launch over land on purpose (Baikonur, Jiuquan), so the page calls it an approximation.
- **Judgement:** an orbit counts as reachable "straight up" when a sea-safe bearing gives its tilt within 1.5°; orbits flatter than the site's latitude need a costly turn ("dogleg"); geostationary transfer is counted from the site's latitude, since every site reaches it by launching east and then flattening the orbit. Target tilts: the ISS 51.6°, polar 90°, Sun-synchronous 97.8° (a typical 600 to 800 km orbit).
- **Approximation:** a launch counts as "from here" when its pad is within 60 km of the spaceport's point, so neighbouring sites such as Kennedy and Cape Canaveral share their launches. Only launches in the atlas's current list (25 upcoming or 25 recent from Launch Library 2) appear.

Mines and processing plants
- **Not verified:** world mine production in 2023 and the biggest producer's share are rounded from the U.S. Geological Survey's *Mineral commodity summaries 2024* (lithium 180,000 t, Australia 48 %; cobalt 230,000 t, DR Congo 74 %; nickel 3.6 Mt, Indonesia 50 %; rare-earth oxides 350,000 t, China 69 %; copper 22 Mt, Chile 23 %; gold 3,000 t, China 12 %; silver 26,000 t, Mexico 25 %; platinum 170 t, South Africa 71 %; palladium 200 t, Russia 44 %; usable iron ore 2.5 Gt, Australia 38 %; graphite 1.6 Mt, China 77 %) and, for uranium, from the World Nuclear Association (about 49,000 t of uranium in 2022, Kazakhstan 43 %). They were written from memory of those publications; this build could not reach either source to check them again.
- **Approximation:** a site's yearly output is read from World Monitor's own text ("~1.2Mt Cu/yr", "2.8 Moz/yr", "~200kt LCE/yr"). A troy ounce is 31.1035 g. Lithium carbonate equivalent counts as 18.8 % lithium. Figures in lithium hydroxide, percentages and "projected" outputs are read as written or left out; a refinery's throughput is compared with world mine output, and the page says so.
- **Judgement:** "what it is for" lists the main uses of each mineral in plain words, in rough order of how much goes to each, from the same USGS summaries; it is not a full breakdown.
- **Approximation:** the nearest port and the export port for the mineral are straight-line distances from World Monitor's lists (or the World Port Index with open data on); real ore travels further by rail, road or pipeline, and the page says so. An export port more than 1,500 km away is flagged as probably not the real route.
- **Judgement:** "priced on" lists the exchanges in World Monitor's commodity list that name the mineral; minerals with no futures contract there (lithium, cobalt, rare earths, uranium) are said to sell mostly on private contracts, which is true of their main markets but leaves out smaller contracts elsewhere.

---

## v2.26: chokepoints, pipelines, trade routes and AI data centres in depth

Everything on the four new pages (`site/app/js/infradetail.js`) is worked out in the browser from data the atlas already ships: World Monitor's pipeline, trade-route, chokepoint and data-centre lists, the EIA's chokepoints, the World Resources Institute's power plants (WRI, 2021 edition) and, when it is on, the Live ships layer. Nothing new is fetched, so the pages also work offline.

Chokepoints
- **Not verified:** the narrowest widths (Hormuz 33.8 km, that is 21 miles; Malacca 2.7 km at the Phillips Channel; Bab el-Mandeb 29 km; the Bosporus 0.7 km; the Øresund 4 km; Gibraltar 14 km; Dover 33 km; Taiwan 130 km; the Korea Strait's western channel 50 km; Kerch and Lombok "roughly") are public figures written from memory of the EIA's chokepoint notes and common references; this build could not reach the sources to check them. The Suez Canal is given as about 200 m wide and 193 km long, the Panama Canal's new locks as 55 m wide.
- **Approximation:** "roughly 6,000 km and 10 to 14 days more" round the Cape of Good Hope instead of Suez (Asia to northern Europe) and "roughly 12,600 km" round South America instead of Panama (New York to San Francisco) are rounded textbook figures; real detours depend on the two ports. Days at sea assume 14 knots.
- **Approximation:** a ship is counted as passing when it is within a set radius of the waterway's point (40 to 150 km, wider for long straits such as Malacca), and its direction comes from its reported course within 60° of the strait's axis. Ships turning or crossing are counted separately. Only ships the Live ships layer hears are counted; without a key that is the Baltic only.
- **Judgement:** pipelines "built to avoid" a chokepoint are named from each line's own history (SUMED and Eilat–Ashkelon for Suez; Petroline, Abqaiq–Yanbu, Habshan–Fujairah and Kirkuk–Ceyhan for Hormuz; Baku–Tbilisi–Ceyhan for the Bosporus; China–Myanmar for Malacca). Their added capacity is an upper bound: the page says the lines may not have room to spare.

Pipelines
- **Approximation:** unit conversions are exact (a barrel is 0.158987 m³, a cubic foot 0.0283168 m³) but three are rounded: about 7.33 barrels to a tonne of crude oil (it varies with the oil), about 10.5 TWh in a billion cubic metres of gas, and an Olympic pool of 2,500 m³ (its minimum volume).
- **Approximation:** world demand of about 102 million barrels of oil a day (IEA, 2024a) and about 4,000 bcm of gas a year (IEA, 2024b) for a line's share.
- **Approximation:** end-to-end time assumes oil moves at 1 to 2 m/s and gas at 5 to 10 m/s, typical design speeds; real flow depends on pressure and throughput.
- **Approximation:** the countries on a line are found by sampling the drawn (simplified) line every 20 km against the atlas's borders, so a short crossing can be missed; the record's own country list is shown beside it.

Trade routes
- **Approximation:** distances are straight great-circle hops between the route's waypoints, so they are a lower bound (the page says so); days assume container ships at 16 knots, tankers at 13 and bulk carriers at 12.5.

AI data centres
- **Approximation:** power is the chip count times an all-in figure per accelerator (its share of servers, network and storage) times a power usage effectiveness (PUE) of 1.2 to 1.56. The per-accelerator figures come from vendors' whole-system power divided by the number of accelerators: DGX A100 6.5 kW for 8, DGX H100 10.2 kW for 8, DGX B200 14.3 kW for 8, a GB200 NVL72 rack about 120 to 132 kW for 72 (NVIDIA, n.d.-a, n.d.-b). Older chips (V100, P100, TPU v1 to v4, Trainium, Gaudi, Groq, Dojo, PEZY) are rougher and **Not verified**; an unknown chip is taken as H100-class. PUE 1.56 is the Uptime Institute's 2024 survey average (Uptime Institute, 2024); 1.2 is a typical target for new AI sites. The page labels the result an estimate, not the owner's figure.
- **Assumption:** the chips run flat out all year for the homes and GWh figures; a US home uses 10,791 kWh a year (2022, U.S. Energy Information Administration, 2023).
- **Approximation:** "big power stations near it" are those of 500 MW or more within 150 km in the WRI database, which ends in 2021; plants built since are missing.

Other changes
- **Judgement:** waterway names now keep "of", "the", "el" and "de" in lower case ("Strait of Hormuz", "Bab el-Mandeb").
- AI data centres in service were drawn faded because the layer looked for the status `operational` while the data says `existing`; fixed.

## v2.25: live watch layers, the whole atlas offline, and tests that cannot age

Where the ideas came from
- **Judgement:** the five layers follow God's Eye View's live layers (Sidhu, 2026; MIT licence) and its DATA_SOURCES.md: which public services to read, their field names, and its rule for an aircraft with poor GPS. No code was copied; `watchfeeds.js` and `watchlayers.js` are written for the atlas.
- **Not verified:** the build environment could not reach nowCOAST, the National Hurricane Center (NHC), the NOAA map services, the NIFC and FAA feature services or adsb.lol. The request addresses and answer fields (for example `idp_source` and `advisnum` in the NHC map service, `attr_IncidentSize` in WFIGS, `UPPER_VAL` and `TYPE_CODE` in the FAA's Special Use Airspace, `nic`, `nac_p` and `gpsOkBefore` from adsb.lol) were taken from God's Eye View's parsers and tests and checked only against sample answers built in their shape (`tests/e2e/watchmock.py`). The first live-data run on GitHub Actions is the first real test; each feed reports in the app's Data health panel and the weekly probe (`tools/probe-sources.mjs`) if it fails.
- **Assumption:** nowCOAST serves the lightning layer as a world image in plate carrée (`SRS=EPSG:4326`, `BBOX=-180,-90,180,90`) with the style `lightning_density`, as any GeoServer map service does. The app reads the live-data copy first (made every ~8 minutes) and nowCOAST itself only when the copy is missing or over half an hour old, because it is not known whether nowCOAST sends the cross-origin (CORS) headers a browser needs to use the image.
- **Approximation:** ring order for the globe is decided by the signed area in plain longitude and latitude (with longitudes unwrapped across the 180° line). That is right for any area smaller than half the planet, which covers every outline the atlas draws; a ring around a pole would need a spherical test instead.

Lightning
- **Approximation:** the image is the 15-minute strike density on nowCOAST's ~8 km grid, in nowCOAST's own colours. It covers the Americas and the Pacific (110° E across the date line to 0°, 25° S to 80° N), not the world. The legend's six colours are from God's Eye View's description of the scale, not read from nowCOAST.
- **Judgement:** NOAA may share the density but not Vaisala's strikes (NOAA Ocean Prediction Center, n.d.), so the atlas shows only the image and never claims single strikes or counts.

Hurricane forecasts
- **Approximation:** CurrentStorms.json gives the speed of motion in miles per hour; the atlas converts it to knots (× 0.868976), as God's Eye View notes. Categories use the Saffir–Simpson thresholds in knots (64, 83, 96, 113 and 137 kt); depressions are storms under 34 kt.
- **Judgement:** when the map service still has the previous advisory's track and cone (it can lag the status file by a few minutes), the storm is drawn with the newest one there and its page says which advisory each part is from. God's Eye View drops the geometry in that case instead.
- **Judgement:** the layer covers the Atlantic and the eastern and central Pacific only (the NHC's areas). Typhoons and cyclones elsewhere stay in the Alerts layer (GDACS).
- **Approximation:** the cone explanation ("about two times in three") paraphrases the NHC's description of how the cone is built.

Wildfire outlines
- **Approximation:** outlines are simplified to about 100 m (`maxAllowableOffset=0.001°`) and rounded to four decimals (about 10 m). A perimeter is as old as its last mapping, often a day.
- **Judgement:** prescribed burns (`RX`) are hidden by default and can be shown from the layer's options. The 120 biggest fires get a pin so they can be found from far away.

Restricted airspace
- **Judgement:** only prohibited (P) and restricted (R) areas are drawn, as God's Eye View does; military operations areas, alert and warning areas and temporary flight restrictions are left out, and the layer says it is not for flight planning.
- **Assumption:** a ceiling of −9998 ft, `UNL`, or flight level 999 means unlimited; the FAA's own coding was not checked.
- **Approximation (illustrative):** areas are raised slightly by their ceiling so a stack reads from an angle; the height is not to scale.

GPS interference
- **Judgement:** an aircraft counts as having poor GPS if it lost GPS (`gpsOkBefore`), or reports NACp under 8, or NIC under 7 except NIC 0 with NACp 10 or more. This is God's Eye View's rule, built on the US ADS-B Out minimums (14 C.F.R. § 91.227); it is not a published interference classifier and has not been checked against known jamming events.
- **Judgement:** cells use gpsjam.org's published formula and bands (Wiseman, n.d.): the first bad aircraft is discounted, then under 2 % is low, 2–10 % medium, over 10 % high. Cells with fewer than 3 aircraft are left out.
- **Approximation:** the cells are 1° squares (about 110 km north to south) from a single few-minute snapshot of about 30 areas, each 250 nautical miles across, not gpsjam.org's 24 hours over the whole world, so a quiet hour can hide interference and areas outside those regions are not counted at all. The areas were chosen by Claude from busy airspace and regions where interference has been widely reported.
- **Assumption:** adsb.lol's terms (ODbL 1.0) allow the live-data job to ask about 30 areas every 10 minutes, one request a second.

Offline mode
- **Judgement:** saved copies are shown offline for up to 45 days as before, except GPS interference (a week, so it is not mistaken for flights by its adsb.lol source, which planes' 20-minute limit would catch) and lightning (a day). Old copies always say how old they are.
- **Judgement:** the service worker now also keeps NASA Solar System Treks tiles (public domain), the Terrarium terrain heights on AWS Open Data and the newest lightning image, within the same 3,000-tile limit. Esri imagery is still left to the browser's cache for its terms.
- **Not verified:** the offline test runs in Chromium with Playwright's network switch; Safari and the desktop app's webview were not tested offline in this release.

Tests
- **Judgement:** to find tests that would break as the date moves on, the whole suite was run with the browser's and Python's clocks moved 180 days ahead. One real fault was found and fixed: a close-up kept the previous place's Sun for up to 10 seconds, so the lights did not come on at once after flying from day to night. Two other failures (Mars's and Saturn's moons "loaded") came from the clock tool hiding the browser's resource timings, not from the app, and were left as they are.
- **Judgement:** the Tests workflow's time limit went from 30 to 50 minutes: the suite already took 26 minutes at v2.22.

## v2.24: dock with the ISS, and positions in search

Where the ideas came from
- **Judgement:** of the six projects Alek sent, three were reference material rather than features: two lists of agent skills and Apple's design guidance (Apache 2.0), used only as a check on the controls' sizes and contrast. Open Eagle Eye (MIT) has fed the worldwide webcam layer since v2.16 and its registry is read live, so nothing new was needed from it. God's Eye View (Sidhu, 2026, MIT) overlaps the atlas almost everywhere (cockpit view, 3D aircraft, night-vision and thermal looks, licence-plate readers, simulated traffic, satellite passes, an area scan); from it came one small idea, typing a position into search. Its live-feed layers (lightning, hurricane forecast cones, wildfire perimeters, restricted airspace, GPS interference) could not be reached from the build environment, so they were not added untested.
- **Judgement:** the docking autopilot for SpaceX's ISS Docking Simulator (Petrov, n.d.) is under the Eclipse Public License 2.0 and drives SpaceX's own website through a browser robot. Neither its code nor SpaceX's simulator was used or copied; the atlas has its own capsule, controls, physics and look, and takes from the project only the idea of an autopilot that flies the approach axis by axis.

The station
- **Approximation:** the station is NASA 3D Resources' "International Space Station (ISS) (B)" model (public domain), thinned from 172,200 to 72,710 triangles. The model is not dated and shows an older layout (its Russian segment and visiting craft differ from the station in 2026); a stray copy of a truss piece floating above it was removed.
- **Approximation:** the model has no units. It was scaled so its main truss is 109 m long; the result is 109 × 76 m with the arrays, against the 109 × 73 m NASA gives, so sizes are good to a few per cent.
- **Assumption:** the forward docking port is the far end of the model's main stack of modules (found by `tools/build-iss.py`), and the model's +x side is the one facing away from the Earth. The model does not say which side is which; the real station flies with Harmony's forward port in the direction of flight, which is how it is placed here.
- **Judgement:** the model's materials are all one grey. Parts were coloured by role (solar arrays dark gold, radiators white, truss grey, modules off-white) from which material each part uses, with colours chosen by eye.
- **Approximation (illustrative):** the capsule is generic (about 4 m across and 8 m long with its trunk, the size of today's crew capsules), not any one company's design.

The flying
- **Approximation:** the motion uses the Clohessy–Wiltshire equations (Clohessy & Wiltshire, 1960) for a circular orbit at the station's height, with thrusters giving a fixed 0.03 m/s² and turning at 0.5°/s². Real capsules have stronger, pulsed thrusters, the orbit is slightly elliptical and drag is ignored; over the few hundred metres and minutes of an approach these errors are small.
- **Not verified:** the soft-capture limits (closing at 0.05–0.10 m/s, within 0.10 m of the axis, sideways drift under 0.04 m/s, lined up within 4°, turning under 0.4°/s) are the initial-contact conditions of the International Docking System Standard as remembered from its interface definition document (International Space Station Multilateral Coordination Board, 2016). The document could not be opened from the build environment to check each number.
- **Approximation:** the approach copies the shape of real ones (a straight-in approach ahead of the station, a hold at 20 m, then about 0.1 m/s to contact), not any one mission's timings. The autopilot docks from 200 m in about 16 simulated minutes; the time speed buttons (10×, 50×) shorten the wait.
- **Approximation:** the Earth below is turned so the point under the station and its direction of travel are the real ones (from its orbital elements, refreshed every 30 seconds), and then turns beneath at the orbital rate. The Sun's direction comes from the real subsolar point, so the station passes into and out of the Earth's shadow at about the times the real one does (the check is geometric: the Sun behind the Earth as seen from the station’s height). With space stations off or offline, it uses a typical orbit and says so.

Search
- **Judgement:** typed positions are read as latitude then longitude unless the letters say otherwise (E or W on the first number), which is the order of the `geo:` link (Mayrhofer & Spanring, 2010) and of most maps. Two bare numbers such as "12 34" are offered as a position at the top of the list, alongside the other matches, not instead of them.

## v2.23: references and assumptions on record

- **Judgement:** this file starts at v2.23, with full sections for the space releases (v2.20 to v2.22). The earlier releases have a shorter section built from what their changelog entries already said; nothing in them was re-checked for this file.
- **Judgement:** the version of the desktop app (`desktop/package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) and of `CITATION.cff` had stayed at 2.12.0 and 2.10.0 since those releases. They now carry the release number, and `check_release.py` fails if any of them differs from `VERSION` in `main.js`.
- **Judgement:** `NOTICE.md` (the change list the AGPL asks for) stopped at v2.12; rows for v2.13 to v2.22 were written from the changelog. Offline mode and Security hardening shipped between v2.14 and v2.15 without numbers of their own; offline mode has its own row and the security work is in the v2.15 row, where it went live.
- **Judgement:** the full MIT notice of Johannes Gajdosik's C code (the source of the moon positions in v2.21 and v2.22) is now kept in `LICENSES/stellarium-planetsephems-MIT.txt`; before, only a shortened quote sat at the top of `outermoons.js` and `smallworlds.js`.
- **Judgement:** some tests store an older version on purpose (`test_v217.py` stores 2.16 to check that What's new lists the newer release first), so `check_release.py` checks only the tests' version checks, not every stored version.

## v2.22: the small worlds

Positions
- **Approximation:** Phobos and Deimos use Lainey's ephemerides of the Martian moons, fitted to observations from 1877 to 2005 (Lainey et al., 2007), as compiled by Gajdosik (2006). Using them in 2026 is an extrapolation of about 20 years; the theory includes Phobos's slow fall towards Mars. No outside ephemeris was available here to compare with, so the tests check only physical sense: distance (Phobos 9,230 to 9,520 km, Deimos about 23,460 km), orbit planes within 2.5° of Mars's equator and the orbital periods.
- **Assumption:** Lainey's frame is turned into the J2000 equator with the node and tilt of Mars's mean equator used in Gajdosik's code (47.68143° and 37.1135°, changing by −0.1061° and +0.0609° a century). Gajdosik's code goes on to the ecliptic; the atlas stops at the equator, which is the frame of everything else in the space view.
- **Approximation:** Ceres, Vesta and Bennu follow fixed two-body (Kepler) orbits from Minor Planet Center osculating elements, as listed in Stellarium's `ssystem_minor.ini` (epochs 2025-09-19 for Ceres and Vesta, 2024-03-31 for Bennu). Planets' pulls make real orbits drift away from these; for Ceres and Vesta the error stays a small fraction of a degree for a few years either side of the epoch. Bennu passes close to the Earth, which changes its orbit a little each time, so its place is called approximate on its card.
- **Assumption:** Charon is placed 19,596 km from Pluto's centre, straight over Pluto's prime meridian, because the International Astronomical Union defines that meridian as the one facing Charon (Archinal et al., 2018) and the two are locked face to face. The barycentre (the point between them that both circle, about 2,100 km outside Pluto's centre) is ignored: Pluto stays where Astronomy Engine puts it.
- **Assumption:** Ceres, Vesta and Bennu turn by fixed rotation elements: Ceres and Vesta from the International Astronomical Union (Archinal et al., 2018), Bennu's pole (right ascension 85.46°, declination −60.36°) and period (4.296 h) from the OSIRIS-REx mission's published values, with its starting angle (W0) set to 0 because its map and shape are not tied to a published one. Which side of Bennu faces you at a given moment is therefore illustrative.
- **Assumption:** the small moons (Phobos, Deimos, Charon) are tidally locked: longitude 0 faces their planet and their pole is the planet's. True to within a few degrees for all three.

Shapes and maps
- **Approximation:** each shape is a radius for every vertex of a 128 × 64 sphere, that is one radius every 2.8°. Shapes that fold back on themselves along a line from the centre cannot be stored this way; Phobos, Deimos, Vesta and Bennu do not, at this resolution. Craters smaller than about 1/40 of the body's width are flattened out of the shape (they remain in the map).
- **Approximation:** each shape is averaged so its mean radius is 1, then drawn at the body's mean radius from NASA's fact sheets. The shapes' own sizes agree with those radii to within about 4 % (Phobos 11.0 km, Deimos 6.1 km, Vesta 263.6 km, Bennu 0.256 km).
- **Assumption:** Stellarium's Phobos, Deimos and Vesta models are latitude–longitude grids, so their texture coordinates are each vertex's longitude and latitude. Checked: fitting directions to texture coordinates leaves a median error of 0.4° (Phobos), 0.9° (Vesta) and 2.5° (Deimos).
- **Judgement:** NASA 3D Resources' Phobos map (1440 × 720) is sharper than Stellarium's model texture (512 × 256). Comparing the two showed Stellarium's texture turned half a turn (correlation 0.98 after a 180° shift), so the Phobos shape is shifted by half a turn to match NASA's map.
- **Judgement:** NASA 3D Resources' Deimos map has unmapped areas filled with white, so Stellarium's Deimos texture is used instead; it is credited as GNU General Public License 2.0 or later (Stellarium's licence for its own graphics), which can be combined with the atlas's AGPL-3.0.
- **Judgement:** Stellarium credits its Ceres and Vesta maps both to USGS (public domain, coloured by its team) and, in another line, to a contributor under Creative Commons Attribution 4.0. Both credits are given in `CREDITS.md`, which satisfies either.
- **Judgement:** NASA 3D Resources' Eros and Itokawa files measure 55 × 51 × 10 and 56 × 52 × 15 units: they are flat relief plaques for 3D printing, not shape models (Eros is really about 34 × 11 × 11 km). Eros and Itokawa were left out rather than drawn wrongly. Stellarium's Eros map looks painted rather than photographed, another reason to leave it out.
- **Not verified:** Bennu's map (from OSIRIS-REx, via Stellarium) is laid on NASA's Bennu shape by the shape's own longitude and latitude. Whether the two share the same zero of longitude was not checked; Bennu is nearly round, so a mismatch would show only as boulders not matching bumps.
- **Assumption:** Charon's map (NASA 3D Resources) is from New Horizons, which saw one side of Charon in detail. How NASA filled the rest was not checked; the card says New Horizons saw one side in detail.
- On Vesta's map the north beyond about 41° N was black (in winter darkness during Dawn's visit) and is drawn plain grey; a credit line printed on the map (NASA/JPL-Caltech/UCLA/MPS/DLR/IDA) was painted over with the strip above it, and the credit is in `CREDITS.md` and on the card.

## v2.21: moons of Saturn, Uranus and Neptune

- **Approximation:** Saturn's moons use TASS 1.7 (Vienne & Duriez, 1995) and Uranus's GUST86 (Laskar & Jacobson, 1987), from Gajdosik's C compilation in Stellarium (MIT licence), accurate to a few hundred kilometres. The tests check distances, orbit planes against each planet's pole, Triton's backward motion and Titan's period, not positions against an outside ephemeris.
- **Approximation:** Triton follows fixed JPL osculating elements for 1 June 2008. Its orbit plane turns once in about 690 years, so by the 2020s its place along the orbit may be a few degrees off; its card says approximate.
- **Assumption:** the big moons are tidally locked with their planet's pole, as for the small moons above.
- **Judgement:** parts of moons no spacecraft has photographed were black in NASA's maps, which read as night. They are drawn plain grey (0.85 × the map's mean brightness) and the cards say so. Titan's map, a rendering of its haze, was toned down towards its real colour.
- **Judgement:** `requestIdleCallback` was given a 5-second limit after the space view never started in the build environment, whose processor was always busy; a busy phone can behave the same.

## v2.20: the whole solar system

- **Approximation (illustrative):** the asteroid belt (6,000 rocks, 2.1 to 3.3 AU) and Kuiper belt (5,000, 39 to 48 AU, a quarter at 39.4 AU) are random orbits with realistic spreads (eccentricity and inclination from half-normal distributions), not real asteroids; the Kirkwood gaps (2.50, 2.82, 2.96 AU) are kept empty. The cards say the rocks are illustrative.
- **Approximation:** Voyager 1 and 2 and New Horizons are placed from their direction from the Sun and their published distance on 1 January 2025, carried forward at a constant cruise speed; good to about 1 AU.
- **Judgement:** the closest you may fly to a body is where one pixel of its best map covers a quarter of a screen pixel, so the view never shows less detail than the data has.
- **Not verified:** NASA's Solar System Treks tile service could not be reached from the build environment; the deep-zoom tests use a stand-in tile, so the real tiles' alignment was checked only by the tile-grid arithmetic.

## v2.13 to v2.19 (from their changelog entries)

- **v2.19:** a storey is 3.2 m where OpenStreetMap gives no `building:levels`; about a third of windows are lit after dark, more from 5 to 11 p.m. and fewer from 1 to 5 a.m. (illustrative); trees are scattered through mapped parks and woods where single trees are not mapped (illustrative).
- **v2.18 and v2.16:** all street traffic is simulated on the real roads (car-following with a 1.2 s gap, 2.5 m/s² acceleration, 6 m/s² braking, lights changing every 30 seconds), and the map says so. Ships glide from their last broadcast position at their reported speed for up to two minutes.
- **v2.15:** fine particles are turned into cigarettes a day after Muller and Muller (2015), a rough equivalence; air quality is model output (Copernicus), not measurement.
- **v2.14:** a ship's cargo is inferred from its AIS type, size and name (ships do not broadcast cargo), and the card says so; a power plant's capacity factor is compared with typical figures for its fuel (U.S. Energy Information Administration), and life-cycle carbon uses IPCC medians.
- **v2.13:** earthquake impact uses the PAGER estimates the U.S. Geological Survey publishes; nothing is re-modelled.
