// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Sun, the planets and the big moons, as cosmos.js draws them.
// Sizes and figures are from NASA's Planetary Fact Sheets (Williams, NASA Space Science Data Coordinated Archive).
// Maps: Solar System Scope's textures (Creative Commons Attribution 4.0, made from NASA mission imagery) and
// NASA 3D Resources (public domain). Positions and spin come from Astronomy Engine at run time, not from here.
//   r: mean radius in km · flat: polar radius / equatorial radius · tex: equirectangular map, east to the right,
//   longitude 0 in the middle · dot: colour of the far-away dot and label · atm: rim glow [r, g, b, strength]
//   airless: lit like bare rock (Lommel-Seeliger), so a full Moon stays bright to its edge
//   trek: a sharper global mosaic on NASA's Solar System Treks tile servers, loaded only when you fly in close
//   shape: a radius map in data/shapes (v2.22, tools/build-smallworlds.py) for a world that is not round
//   rot: [pole right ascension, pole declination, W0, W1] (IAU rotation elements, degrees and degrees a day) for a
//   body Astronomy Engine does not turn
//   trekMax: the deepest level of that tile pyramid worth loading, from the mosaic's own resolution (v2.20: tiles down
//   to it are loaded around the point you look at)

export const BODIES = [
  {
    id: 'sun', name: 'Sun', kind: 'Star', r: 695700, tex: 'sun.jpg', dot: '#ffd27a', credit: 'sss', glyph: '☉',
    facts: [['Radius', '695,700 km'], ['Mass', '333,000 Earths'], ['Surface', '5,500 °C'], ['Core', '15 million °C'], ['Spins once in', '25 days (equator)'], ['Age', '4.6 billion years']],
    about: 'A middle-aged yellow dwarf star holding 99.86 % of the solar system’s mass. Its light takes about 8 minutes 20 seconds to reach Earth. The surface here is a map made from NASA images; it slowly churns like the real granulation.',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'Planet', r: 2439.7, tex: 'mercury.jpg', dot: '#b9b1a6', credit: 'sss', airless: 1, glyph: '☿',
    trekMax: 6, trek: 'https://trek.nasa.gov/tiles/Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m/1.0.0/default/default028mm',
    facts: [['Radius', '2,440 km'], ['Day (sunrise to sunrise)', '176 Earth days'], ['Year', '88 days'], ['Gravity', '0.38 × Earth'], ['Temperature', '−180 to 430 °C'], ['Moons', '0']],
    about: 'The smallest planet and the closest to the Sun. With almost no air to hold heat, its days bake and its nights freeze. NASA’s MESSENGER mapped all of it from orbit between 2011 and 2015.',
  },
  {
    id: 'venus', name: 'Venus', kind: 'Planet', r: 6051.8, tex: 'venus-clouds.jpg', tex2: 'venus-surface.jpg', dot: '#f3e2b6', credit: 'sss', atm: [1.0, 0.86, 0.6, 0.55], glyph: '♀',
    facts: [['Radius', '6,052 km'], ['Day', '117 Earth days'], ['Spins', 'backwards, once in 243 days'], ['Year', '225 days'], ['Surface', '465 °C'], ['Air pressure', '92 × Earth']],
    about: 'Earth’s near twin in size, smothered by a carbon dioxide atmosphere and sulfuric acid clouds that trap heat: the hottest surface of any planet. Press “See the surface” for NASA Magellan’s radar map under the clouds.',
  },
  {
    id: 'earth', name: 'Earth', kind: 'Planet', r: 6371.0, dot: '#7fb6ff', credit: 'bluemarble', glyph: '♁',
    facts: [['Radius', '6,371 km'], ['Day', '24 hours'], ['Year', '365.25 days'], ['Tilt', '23.4°'], ['Average', '15 °C'], ['Moons', '1']],
    about: 'Home: the only world known to have life and liquid oceans on its surface.',
  },
  {
    id: 'moon', name: 'Moon', kind: 'Earth’s moon', r: 1737.4, tex: 'moon.jpg', dot: '#e8e6df', credit: 'sss', airless: 1, parent: 'earth', glyph: '☾',
    trekMax: 8, trek: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm',
    facts: [['Radius', '1,737 km'], ['Orbits Earth in', '27.3 days'], ['Phases repeat every', '29.5 days'], ['Gravity', '0.17 × Earth'], ['Temperature', '−170 to 120 °C'], ['People who walked on it', '12 (1969–1972)']],
    about: 'Shown where it really is, turned the way it really faces us (its slow wobble, libration, included) and lit by the real Sun, so its phase here matches the sky. The map is made from NASA Lunar Reconnaissance Orbiter (LRO) images; fly in close for NASA’s full-resolution mosaic.',
  },
  {
    id: 'mars', name: 'Mars', kind: 'Planet', r: 3389.5, flat: 0.9941, tex: 'mars.jpg', dot: '#e0805a', credit: 'sss', atm: [1.0, 0.62, 0.42, 0.28], glyph: '♂',
    trekMax: 7, trek: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm',
    facts: [['Radius', '3,390 km'], ['Day', '24 h 40 min'], ['Year', '687 days'], ['Gravity', '0.38 × Earth'], ['Average', '−65 °C'], ['Moons', '2']],
    about: 'A cold desert with the solar system’s tallest volcano (Olympus Mons, about 22 km) and a canyon as long as the United States (Valles Marineris). Rovers are driving on it right now.',
  },
  {
    id: 'phobos', name: 'Phobos', kind: 'Moon of Mars', r: 11.08, tex: 'phobos.jpg', shape: 'phobos', dot: '#b8a48e', credit: 'nasa3d', airless: 1, parent: 'mars', glyph: '●',
    facts: [['Size', '27 × 22 × 18 km'], ['Orbits Mars in', '7 h 39 min'], ['Above Mars', 'about 6,000 km'], ['Biggest crater', 'Stickney, 9 km']],
    about: 'A dark, lumpy moon so close to Mars that it goes round three times a day, rising in the west. Mars’s pull is slowly drawing it in: in some tens of millions of years it will break up or crash. Its shape is the real one, from spacecraft images.',
  },
  {
    id: 'deimos', name: 'Deimos', kind: 'Moon of Mars', r: 6.2, tex: 'deimos.jpg', shape: 'deimos', dot: '#c7b8a2', credit: 'stellarium', airless: 1, parent: 'mars', glyph: '●',
    facts: [['Size', '15 × 12 × 11 km'], ['Orbits Mars in', '30 h 18 min'], ['Above Mars', 'about 20,000 km'], ['Surface', 'smoothed by dust']],
    about: 'The smaller and farther of Mars’s two moons, its craters softened under a blanket of dust. From Mars it looks like a bright star that takes two and a half days to cross the sky. Its shape is the real one, from Viking and Mars Reconnaissance Orbiter images.',
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'Planet', r: 69911, flat: 0.9351, tex: 'jupiter.jpg', dot: '#e8c9a0', credit: 'sss', atm: [0.95, 0.85, 0.7, 0.3], glyph: '♃',
    facts: [['Radius', '69,911 km (11 Earths)'], ['Day', '9 h 56 min'], ['Year', '11.9 years'], ['Gravity', '2.4 × Earth'], ['Cloud tops', '−110 °C'], ['Moons', '95+']],
    about: 'A gas giant more than twice as massive as all the other planets together. The Great Red Spot is a storm wider than Earth that has blown for at least 190 years. Its four big moons are drawn where they really are.',
  },
  {
    id: 'io', name: 'Io', kind: 'Moon of Jupiter', r: 1821.6, tex: 'io.jpg', dot: '#e8d27a', credit: 'nasa3d', airless: 1, parent: 'jupiter', glyph: '●',
    facts: [['Radius', '1,822 km'], ['Orbits Jupiter in', '1.8 days'], ['Active volcanoes', 'about 400']],
    about: 'The most volcanic world known: Jupiter’s pull flexes it so hard that its insides melt.',
  },
  {
    id: 'europa', name: 'Europa', kind: 'Moon of Jupiter', r: 1560.8, tex: 'europa.jpg', dot: '#efe6d6', credit: 'nasa3d', airless: 1, parent: 'jupiter', glyph: '●',
    facts: [['Radius', '1,561 km'], ['Orbits Jupiter in', '3.6 days'], ['Ocean under the ice', 'about 100 km deep']],
    about: 'A cracked shell of ice over a salty ocean holding more water than all of Earth’s oceans: one of the best places to look for life. NASA’s Europa Clipper arrives in 2030.',
  },
  {
    id: 'ganymede', name: 'Ganymede', kind: 'Moon of Jupiter', r: 2634.1, tex: 'ganymede.jpg', dot: '#cfc4b4', credit: 'nasa3d', airless: 1, parent: 'jupiter', glyph: '●',
    facts: [['Radius', '2,634 km'], ['Orbits Jupiter in', '7.2 days'], ['Bigger than', 'Mercury']],
    about: 'The largest moon in the solar system and the only one with its own magnetic field.',
  },
  {
    id: 'callisto', name: 'Callisto', kind: 'Moon of Jupiter', r: 2410.3, tex: 'callisto.jpg', dot: '#a99c8a', credit: 'nasa3d', airless: 1, parent: 'jupiter', glyph: '●',
    facts: [['Radius', '2,410 km'], ['Orbits Jupiter in', '16.7 days'], ['Surface age', 'about 4 billion years']],
    about: 'The most heavily cratered body known: its surface has barely changed since the solar system was young.',
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'Planet', r: 58232, flat: 0.902, tex: 'saturn.jpg', dot: '#ecd9a8', credit: 'sss', atm: [0.95, 0.88, 0.7, 0.25], ring: [1.239, 2.27], glyph: '♄',
    facts: [['Radius', '58,232 km (9 Earths)'], ['Day', '10 h 33 min'], ['Year', '29.4 years'], ['Rings', '282,000 km across'], ['Density', 'less than water'], ['Moons', '270+']],
    about: 'Its rings are billions of pieces of water ice, from grains to house-sized blocks, yet mostly just tens of metres thick. They are drawn at their real tilt, with Saturn’s shadow falling across them.',
  },
  {
    id: 'mimas', name: 'Mimas', kind: 'Moon of Saturn', r: 198.2, tex: 'mimas.jpg', dot: '#cfcac2', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '198 km'], ['Orbits Saturn in', '22.6 hours'], ['Biggest crater', 'Herschel, 130 km']],
    about: 'Small and icy, with one giant crater a third as wide as the moon itself.',
  },
  {
    id: 'enceladus', name: 'Enceladus', kind: 'Moon of Saturn', r: 252.1, tex: 'enceladus.jpg', dot: '#f4f6f8', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '252 km'], ['Orbits Saturn in', '1.4 days'], ['Reflects', 'about 99 % of sunlight']],
    about: 'Jets of water from an ocean under the ice spray out of cracks at its south pole and feed one of Saturn’s rings. Cassini flew through them.',
  },
  {
    id: 'tethys', name: 'Tethys', kind: 'Moon of Saturn', r: 531.1, tex: 'tethys.jpg', dot: '#e3e0da', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '531 km'], ['Orbits Saturn in', '1.9 days'], ['Canyon', 'Ithaca Chasma, 2,000 km long']],
    about: 'Almost pure water ice, with a crater (Odysseus) 450 km across and a canyon running most of the way round.',
  },
  {
    id: 'dione', name: 'Dione', kind: 'Moon of Saturn', r: 561.4, tex: 'dione.jpg', dot: '#d9d6cf', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '561 km'], ['Orbits Saturn in', '2.7 days'], ['Wispy lines', 'ice cliffs hundreds of metres high']],
    about: 'Its bright streaks, once thought to be frost, turned out to be ice cliffs where the crust has cracked.',
  },
  {
    id: 'rhea', name: 'Rhea', kind: 'Moon of Saturn', r: 763.8, tex: 'rhea.jpg', dot: '#d4d0c8', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '764 km'], ['Orbits Saturn in', '4.5 days'], ['Rank', 'Saturn’s second-largest moon']],
    about: 'A cold, heavily cratered ball of ice and rock.',
  },
  {
    id: 'titan', name: 'Titan', kind: 'Moon of Saturn', r: 2574.7, tex: 'titan.jpg', dot: '#d9a964', credit: 'nasa3d', parent: 'saturn', glyph: '●', atm: [0.9, 0.62, 0.32, 0.35],
    facts: [['Radius', '2,575 km (bigger than Mercury)'], ['Orbits Saturn in', '16 days'], ['Air at the ground', '1.5 times Earth’s'], ['Surface', '−179 °C']],
    about: 'The only moon with thick air, an orange smog of nitrogen and methane hiding rivers, lakes and seas of liquid methane. ESA’s Huygens landed in 2005; NASA’s Dragonfly drone is due in 2034.',
  },
  {
    id: 'iapetus', name: 'Iapetus', kind: 'Moon of Saturn', r: 734.5, tex: 'iapetus.jpg', dot: '#a8998a', credit: 'nasa3d', airless: 1, parent: 'saturn', glyph: '●',
    facts: [['Radius', '735 km'], ['Orbits Saturn in', '79 days'], ['Equatorial ridge', 'up to 20 km high']],
    about: 'Two-faced: the side leading round its orbit is as dark as coal, the other as bright as snow.',
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'Planet', r: 25362, flat: 0.9771, tex: 'uranus.jpg', dot: '#a9e1e8', credit: 'sss', atm: [0.6, 0.9, 1.0, 0.35], glyph: '⛢',
    facts: [['Radius', '25,362 km (4 Earths)'], ['Day', '17 h 14 min (backwards)'], ['Year', '84 years'], ['Tilt', '98°: it rolls on its side'], ['Cloud tops', '−195 °C'], ['Moons', '28']],
    about: 'An ice giant knocked onto its side, probably by a giant collision, so each pole gets 42 years of sunlight and then 42 years of night. Only Voyager 2 has visited, in 1986.',
  },
  {
    id: 'miranda', name: 'Miranda', kind: 'Moon of Uranus', r: 235.8, tex: 'miranda.jpg', dot: '#c9c6c2', credit: 'nasa3d', airless: 1, parent: 'uranus', glyph: '●',
    facts: [['Radius', '236 km'], ['Orbits Uranus in', '1.4 days'], ['Tallest cliff', 'Verona Rupes, about 20 km']],
    about: 'A patchwork of grooves and cliffs that looks pieced together. Voyager 2 flew past in 1986 and photographed only the half facing the Sun then; the plain grey on this map is the part no spacecraft has seen.',
  },
  {
    id: 'ariel', name: 'Ariel', kind: 'Moon of Uranus', r: 578.9, tex: 'ariel.jpg', dot: '#cdc9c3', credit: 'nasa3d', airless: 1, parent: 'uranus', glyph: '●',
    facts: [['Radius', '579 km'], ['Orbits Uranus in', '2.5 days'], ['Surface', 'the youngest of Uranus’s big moons']],
    about: 'Criss-crossed by valleys where its icy crust has pulled apart. Voyager 2 flew past in 1986 and photographed only the half facing the Sun then; the plain grey on this map is the part no spacecraft has seen.',
  },
  {
    id: 'umbriel', name: 'Umbriel', kind: 'Moon of Uranus', r: 584.7, tex: 'umbriel.jpg', dot: '#8f8a84', credit: 'nasa3d', airless: 1, parent: 'uranus', glyph: '●',
    facts: [['Radius', '585 km'], ['Orbits Uranus in', '4.1 days'], ['Brightness', 'the darkest of Uranus’s big moons']],
    about: 'Old, dark and covered in craters, with one bright ring near its pole. Voyager 2 flew past in 1986 and photographed only the half facing the Sun then; the plain grey on this map is the part no spacecraft has seen.',
  },
  {
    id: 'titania', name: 'Titania', kind: 'Moon of Uranus', r: 788.9, tex: 'titania.jpg', dot: '#c4bdb4', credit: 'nasa3d', airless: 1, parent: 'uranus', glyph: '●',
    facts: [['Radius', '789 km'], ['Orbits Uranus in', '8.7 days'], ['Rank', 'Uranus’s largest moon']],
    about: 'Cut by canyons up to 1,500 km long. Voyager 2 flew past in 1986 and photographed only the half facing the Sun then; the plain grey on this map is the part no spacecraft has seen.',
  },
  {
    id: 'oberon', name: 'Oberon', kind: 'Moon of Uranus', r: 761.4, tex: 'oberon.jpg', dot: '#b5aca2', credit: 'nasa3d', airless: 1, parent: 'uranus', glyph: '●',
    facts: [['Radius', '761 km'], ['Orbits Uranus in', '13.5 days'], ['Rank', 'the outermost of the big five']],
    about: 'Old and cratered, with dark patches on some crater floors. Voyager 2 flew past in 1986 and photographed only the half facing the Sun then; the plain grey on this map is the part no spacecraft has seen.',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'Planet', r: 24622, flat: 0.9829, tex: 'neptune.jpg', dot: '#6f8ff0', credit: 'sss', atm: [0.45, 0.6, 1.0, 0.35], glyph: '♆',
    facts: [['Radius', '24,622 km (4 Earths)'], ['Day', '16 h 6 min'], ['Year', '165 years'], ['Fastest winds', '2,100 km/h'], ['Cloud tops', '−200 °C'], ['Moons', '16']],
    about: 'The farthest planet: dark, cold and swept by the fastest winds measured anywhere in the solar system. It was found in 1846 from the pull it had on Uranus, before anyone saw it.',
  },
  {
    id: 'triton', name: 'Triton', kind: 'Moon of Neptune', r: 1353.4, tex: 'triton.jpg', dot: '#d9c9c0', credit: 'nasa3d', airless: 1, parent: 'neptune', glyph: '●',
    facts: [['Radius', '1,353 km'], ['Orbits Neptune in', '5.9 days, backwards'], ['Surface', '−235 °C'], ['Geysers', 'nitrogen, 8 km high']],
    about: 'The only big moon that goes round its planet backwards, so it was probably a Kuiper belt world that Neptune captured. Voyager 2 saw nitrogen geysers in 1989, on the part shown here; the plain grey is the part no spacecraft has seen. Its place on its orbit is approximate.',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'Dwarf planet', r: 1188.3, tex: 'pluto.jpg', dot: '#d8c3a8', credit: 'sss', airless: 1, glyph: '♇',
    facts: [['Radius', '1,188 km'], ['Day', '6.4 Earth days (backwards)'], ['Year', '248 years'], ['Surface', '−230 °C'], ['Moons', '5']],
    about: 'A world of nitrogen ice glaciers and water-ice mountains, first seen up close by NASA’s New Horizons in 2015. The black band is the part New Horizons could not see: it was in the dark.',
  },
  {
    id: 'charon', name: 'Charon', kind: 'Moon of Pluto', r: 606, tex: 'charon.jpg', dot: '#bfb3a6', credit: 'nasa3dnh', airless: 1, parent: 'pluto', glyph: '●',
    facts: [['Radius', '606 km (half of Pluto)'], ['Orbits Pluto in', '6.4 days'], ['From Pluto', '19,600 km'], ['Red north pole', 'Mordor Macula']],
    about: 'Half Pluto’s size, so big that the two swing round a point between them. Each always shows the other the same face, so Charon hangs over one spot in Pluto’s sky. New Horizons saw canyons longer than the Grand Canyon in 2015; it saw one side of Charon in detail.',
  },
  {
    id: 'ceres', name: 'Ceres', kind: 'Dwarf planet (asteroid belt)', r: 482, flat: 0.925, tex: 'ceres.jpg', dot: '#b5ab9c', credit: 'usgsdawn', airless: 1, glyph: '⚳', rot: [291.418, 66.764, 170.65, 952.1532],
    facts: [['Radius', '470 km'], ['Day', '9 h 4 min'], ['Year', '4.6 years'], ['Share of the belt’s mass', 'about 40 %'], ['Bright spots', 'salts in Occator crater']],
    about: 'The biggest world in the asteroid belt, round under its own gravity. NASA’s Dawn orbited it from 2015 to 2018 and found salty brine that once welled up into Occator crater, leaving the white spots. Its place is from its orbit (Minor Planet Center).',
  },
  {
    id: 'vesta', name: 'Vesta', kind: 'Asteroid', r: 262.7, tex: 'vesta.jpg', shape: 'vesta', dot: '#c9c3b8', credit: 'usgsdawn', airless: 1, glyph: '⚶', rot: [309.031, 42.235, 285.39, 1617.3329428],
    facts: [['Size', '573 × 557 × 446 km'], ['Day', '5 h 20 min'], ['Year', '3.6 years'], ['South pole', 'Rheasilvia, a crater 500 km wide'], ['Pieces on Earth', 'about 1 meteorite in 20']],
    about: 'The second biggest asteroid, with a giant crater, Rheasilvia, that took away much of its south pole; the blow threw out the rocks that fall to Earth as HED meteorites. Dawn orbited it in 2011 and 2012. Its shape is the real one; the grey in the north was in winter darkness when Dawn was there.',
  },
  {
    id: 'bennu', name: 'Bennu', kind: 'Near-Earth asteroid', r: 0.245, tex: 'bennu.jpg', shape: 'bennu', dot: '#9c9890', credit: 'nasaosirisrex', airless: 1, glyph: '◆', rot: [85.46, -60.36, 0, 2011.145],
    facts: [['Size', '565 × 535 × 508 m'], ['Day', '4 h 18 min'], ['Year', '1.2 years'], ['Sample brought home', '122 g, 24 September 2023'], ['Chance of hitting Earth', 'about 1 in 2,700 by 2300']],
    about: 'A spinning-top pile of rubble loosely held together, rich in carbon and water-bearing minerals. NASA’s OSIRIS-REx touched it in 2020 and its capsule landed in Utah in 2023 with the biggest asteroid sample ever returned. Its place comes from a fixed orbit, so it is approximate.',
  },
];

export const BODY = Object.fromEntries(BODIES.map((b) => [b.id, b]));
