# Assumptions and approximations

What the atlas assumes, simplifies or could not check, release by release, with the reason and where it shows. The sources themselves are in [REFERENCES.md](REFERENCES.md) (APA 7th edition) and `site/app/js/sources.js`; licences and changes to other people's work are in [NOTICE.md](../NOTICE.md), [`LICENSES/`](../LICENSES) and [`site/app/textures/space/CREDITS.md`](../site/app/textures/space/CREDITS.md).

How to read it: **Assumption** is something taken as true without checking it here. **Approximation** is a known simplification with its size of error. **Not verified** is something that could not be tested in the build environment. **Judgement** is a choice between sources or methods, with the reason.

Every release adds a section at the top. `tests/docs/check_release.py` fails if the current version has no section.

---

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
