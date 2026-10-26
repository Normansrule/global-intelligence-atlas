// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the Sun, the planets and the big moons, as cosmos.js draws them.
// Sizes and figures are from NASA's Planetary Fact Sheets (Williams, NASA Space Science Data Coordinated Archive).
// Maps: Solar System Scope's textures (Creative Commons Attribution 4.0, made from NASA mission imagery) and
// NASA 3D Resources (public domain). Positions and spin come from Astronomy Engine at run time, not from here.
//   r: mean radius in km · flat: polar radius / equatorial radius · tex: equirectangular map, east to the right,
//   longitude 0 in the middle · dot: colour of the far-away dot and label · atm: rim glow [r, g, b, strength]
//   airless: lit like bare rock (Lommel-Seeliger), so a full Moon stays bright to its edge
//   trek: a sharper global mosaic on NASA's Solar System Treks tile servers, loaded only when you fly in close

export const BODIES = [
  {
    id: 'sun', name: 'Sun', kind: 'Star', r: 695700, tex: 'sun.jpg', dot: '#ffd27a', credit: 'sss', glyph: '☉',
    facts: [['Radius', '695,700 km'], ['Mass', '333,000 Earths'], ['Surface', '5,500 °C'], ['Core', '15 million °C'], ['Spins once in', '25 days (equator)'], ['Age', '4.6 billion years']],
    about: 'A middle-aged yellow dwarf star holding 99.86 % of the solar system’s mass. Its light takes about 8 minutes 20 seconds to reach Earth. The surface here is a map made from NASA images; it slowly churns like the real granulation.',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'Planet', r: 2439.7, tex: 'mercury.jpg', dot: '#b9b1a6', credit: 'sss', airless: 1, glyph: '☿',
    trek: 'https://trek.nasa.gov/tiles/Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m/1.0.0/default/default028mm',
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
    trek: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm',
    facts: [['Radius', '1,737 km'], ['Orbits Earth in', '27.3 days'], ['Phases repeat every', '29.5 days'], ['Gravity', '0.17 × Earth'], ['Temperature', '−170 to 120 °C'], ['People who walked on it', '12 (1969–1972)']],
    about: 'Shown where it really is, turned the way it really faces us (its slow wobble, libration, included) and lit by the real Sun, so its phase here matches the sky. The map is made from NASA Lunar Reconnaissance Orbiter (LRO) images; fly in close for NASA’s full-resolution mosaic.',
  },
  {
    id: 'mars', name: 'Mars', kind: 'Planet', r: 3389.5, flat: 0.9941, tex: 'mars.jpg', dot: '#e0805a', credit: 'sss', atm: [1.0, 0.62, 0.42, 0.28], glyph: '♂',
    trek: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm',
    facts: [['Radius', '3,390 km'], ['Day', '24 h 40 min'], ['Year', '687 days'], ['Gravity', '0.38 × Earth'], ['Average', '−65 °C'], ['Moons', '2']],
    about: 'A cold desert with the solar system’s tallest volcano (Olympus Mons, about 22 km) and a canyon as long as the United States (Valles Marineris). Rovers are driving on it right now.',
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
    id: 'uranus', name: 'Uranus', kind: 'Planet', r: 25362, flat: 0.9771, tex: 'uranus.jpg', dot: '#a9e1e8', credit: 'sss', atm: [0.6, 0.9, 1.0, 0.35], glyph: '⛢',
    facts: [['Radius', '25,362 km (4 Earths)'], ['Day', '17 h 14 min (backwards)'], ['Year', '84 years'], ['Tilt', '98°: it rolls on its side'], ['Cloud tops', '−195 °C'], ['Moons', '28']],
    about: 'An ice giant knocked onto its side, probably by a giant collision, so each pole gets 42 years of sunlight and then 42 years of night. Only Voyager 2 has visited, in 1986.',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'Planet', r: 24622, flat: 0.9829, tex: 'neptune.jpg', dot: '#6f8ff0', credit: 'sss', atm: [0.45, 0.6, 1.0, 0.35], glyph: '♆',
    facts: [['Radius', '24,622 km (4 Earths)'], ['Day', '16 h 6 min'], ['Year', '165 years'], ['Fastest winds', '2,100 km/h'], ['Cloud tops', '−200 °C'], ['Moons', '16']],
    about: 'The farthest planet: dark, cold and swept by the fastest winds measured anywhere in the solar system. It was found in 1846 from the pull it had on Uranus, before anyone saw it.',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'Dwarf planet', r: 1188.3, tex: 'pluto.jpg', dot: '#d8c3a8', credit: 'sss', airless: 1, glyph: '♇',
    facts: [['Radius', '1,188 km'], ['Day', '6.4 Earth days (backwards)'], ['Year', '248 years'], ['Surface', '−230 °C'], ['Moons', '5']],
    about: 'A world of nitrogen ice glaciers and water-ice mountains, first seen up close by NASA’s New Horizons in 2015. The black band is the part New Horizons could not see: it was in the dark.',
  },
];

export const BODY = Object.fromEntries(BODIES.map((b) => [b.id, b]));
