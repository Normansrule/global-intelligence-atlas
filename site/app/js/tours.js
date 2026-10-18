// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas — guided tours. Each step flies the camera, sets the layers it needs
// and tells a short, sourced story. Steps are a real sequence, so they are numbered.

export const TOURS = [
  {
    id: 'ring-of-fire', title: 'The Ring of Fire', blurb: 'Why three-quarters of the world’s earthquakes and volcanoes line the Pacific.',
    base: 'bluemarble', layers: ['quakes', 'plates', 'events', 'borders'],
    steps: [
      { pov: { lat: 5, lng: -160, altitude: 2.6 }, title: 'One plate, one ring', text: 'The Pacific Plate is the largest on Earth. Almost all the way around its edge, it meets other plates — and nearly every earthquake dot on the globe falls on that seam.' },
      { pov: { lat: 37, lng: 142, altitude: 0.7 }, title: 'Japan Trench', text: 'Here the Pacific Plate dives west beneath Japan at about 8 cm a year. The 2011 Tōhoku earthquake (Mw 9.1) ruptured roughly 400 km of this boundary.' },
      { pov: { lat: -22, lng: -72, altitude: 0.9 }, title: 'The Andes', text: 'The Nazca Plate sinks under South America. Shallow quakes sit at the trench offshore; they get deeper inland, tracing the sinking slab down to 600 km or more.' },
      { pov: { lat: 54, lng: -165, altitude: 0.9 }, title: 'The Aleutian arc', text: 'A chain of volcanic islands forms where the Pacific slides under North America. Magma rises from about 100 km above the sinking slab — a curve that mirrors the trench.' },
      { pov: { lat: 36, lng: -120, altitude: 0.8 }, title: 'A different kind of boundary', text: 'In California the plates slide past each other instead. The San Andreas is a transform fault: few volcanoes, but frequent shallow quakes.' },
    ],
  },
  {
    id: 'internet', title: 'Arteries of the internet', blurb: 'The cables that carry almost all intercontinental data — and the physics that limits them.',
    base: 'daynight', layers: ['cables', 'borders', 'sun'],
    steps: [
      { pov: { lat: 42, lng: -40, altitude: 1.4 }, title: 'The North Atlantic', text: 'Dozens of fibre pairs link North America and Europe. MAREA, Grace Hopper and Amitié are owned partly by the cloud companies whose traffic they carry.' },
      { pov: { lat: 20, lng: 42, altitude: 0.9 }, title: 'Red Sea bottleneck', text: 'Cables between Europe and Asia squeeze through the Red Sea and the Bab el-Mandeb strait. A single anchor drag here can slow traffic for a continent.' },
      { pov: { lat: 1.3, lng: 104, altitude: 0.8 }, title: 'Singapore and the Luzon Strait', text: 'Southeast Asia’s cables bunch around Singapore and the Luzon Strait — also one of the most earthquake-prone seafloors, which has cut cables before (2006 Hengchun earthquake).' },
      { pov: { lat: 0, lng: -150, altitude: 2.2 }, title: 'The speed of light is the limit', text: 'Light in fibre moves at about 204,000 km/s. Across the Pacific (~9,000 km) that is 44 ms one way before any router adds delay. Try Measure to compute it for any pair of cities.' },
    ],
  },
  {
    id: 'chokepoints', title: 'Chokepoints of world trade', blurb: 'Where a few kilometres of water carry a large share of global shipping.',
    base: 'bluemarble', layers: ['routes', 'waterways', 'ports', 'borders'],
    steps: [
      { pov: { lat: 18, lng: 70, altitude: 2.0 }, title: 'Following the ships', text: 'Most container and tanker traffic between Asia, the Middle East and Europe follows the same few lanes. The arcs show the main routes in World Monitor’s catalogue.' },
      { pov: { lat: 2.5, lng: 101.5, altitude: 0.6 }, title: 'Strait of Malacca', text: 'The shortest sea route between the Indian Ocean and the Pacific. Its narrowest shipping channel, the Phillip Channel near Singapore, is under 3 km wide.' },
      { pov: { lat: 26.5, lng: 56.3, altitude: 0.5 }, title: 'Strait of Hormuz', text: 'The only sea exit from the Persian Gulf. The EIA estimates roughly a fifth of global petroleum liquids consumption passes through it.' },
      { pov: { lat: 30.5, lng: 32.3, altitude: 0.5 }, title: 'Suez Canal', text: 'Saves about 7,000 km versus sailing around Africa. When it closes, ships reroute via the Cape of Good Hope, adding 10–14 days.' },
      { pov: { lat: 9, lng: -79.7, altitude: 0.5 }, title: 'Panama Canal', text: 'Lock-based, so it depends on rainfall feeding Gatun Lake. Droughts force draft and transit limits — climate becomes a trade story.' },
    ],
  },
  {
    id: 'orbits', title: 'Orbits 101', blurb: 'From the ISS to the geostationary belt — and why the heights are what they are.',
    base: 'daynight', layers: ['stations', 'satellites', 'sun'], satGroups: ['visual', 'gps-ops', 'geo'],
    steps: [
      { pov: { lat: 20, lng: -30, altitude: 1.6 }, title: 'Low Earth orbit', text: 'The ISS flies about 420 km up at 7.66 km/s and circles Earth every ~92 minutes. Most satellites — imaging, weather, Starlink — live below 2,000 km.' },
      { pov: { lat: 10, lng: -30, altitude: 5.5 }, title: 'The GPS shell', text: 'GPS satellites orbit at 20,200 km, completing two orbits per sidereal day. At least four must be in view to fix your position: three for location, one to solve for your receiver’s clock error.' },
      { pov: { lat: 60, lng: 0, altitude: 9 }, title: 'The geostationary ring', text: 'At 35,786 km an orbit takes exactly one sidereal day, so a satellite over the equator appears fixed in the sky. This is Kepler’s third law: period² ∝ radius³.' },
      { pov: { lat: 30, lng: -90, altitude: 2.4 }, title: 'Back to the ground track', text: 'The ISS ground track drifts about 23° west each orbit because Earth turns underneath. Click the ISS to see its live altitude, speed and period.' },
    ],
  },
  {
    id: 'seasons', title: 'Day, night and the seasons', blurb: 'What the terminator and the subsolar point say about the time of year.',
    base: 'daynight', layers: ['sun', 'grid', 'borders'],
    steps: [
      { pov: { lat: 0, lng: 0, altitude: 2.6 }, title: 'Where it is noon', text: 'The subsolar point marks where the Sun is straight overhead. It moves west at 15° per hour — 1,670 km/h at the equator.' },
      { pov: { lat: 60, lng: 0, altitude: 2.4 }, title: 'The tilt does the work', text: 'Earth’s axis is tilted 23.44°. As we orbit, the subsolar point wanders between the tropics, and the terminator tilts toward one pole or the other.' },
      { pov: { lat: 88, lng: 0, altitude: 2.2 }, title: 'Midnight sun', text: 'Around the June solstice everything inside the Arctic Circle stays in daylight all day; at the December solstice it is the Antarctic’s turn.' },
      { pov: { lat: 0, lng: -60, altitude: 2.6 }, title: 'Equinoxes', text: 'Near March 20 and September 22 the terminator runs through both poles and every place gets roughly 12 hours of day. Compare today’s line with that.' },
    ],
  },
  {
    id: 'power', title: 'Energy, compute and critical minerals', blurb: 'How the physical supply chain of AI spreads across the map.',
    base: 'night', layers: ['datacenters', 'pipelines', 'nuclear', 'minerals', 'borders'],
    steps: [
      { pov: { lat: 38, lng: -95, altitude: 1.3 }, title: 'Compute follows power', text: 'The largest AI clusters cluster where grid power, land and fibre are cheap. The night-lights base map shows where people — and power demand — already are.' },
      { pov: { lat: 47, lng: 10, altitude: 1.3 }, title: 'Europe’s energy web', text: 'Gas pipelines converge from Norway, North Africa and the east; France runs one of the densest nuclear fleets in the world.' },
      { pov: { lat: -10, lng: 25, altitude: 1.6 }, title: 'Where the minerals are', text: 'Cobalt from the DR Congo, lithium from Australia and the Andes, rare earths from China: the raw materials for batteries and chips come from a handful of places.' },
    ],
  },
];
