// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: where spacecraft have landed on the Moon and on Mars, as cosmos.js pins them.
// Latitude and longitude are planetocentric, east positive (the frame of the Moon and Mars maps). Apollo sites are
// the lunar module positions from Davies and Colvin (2000); the others are from the NASA Space Science Data
// Coordinated Archive (NSSDCA) master catalog and the mission teams' published landing coordinates.
//   who: the agency (NASA, the Soviet Union, the China National Space Administration (CNSA), the Indian Space Research
//   Organisation (ISRO), the Japan Aerospace Exploration Agency (JAXA), or the company) · crew: people who walked there

export const LANDINGS = {
  moon: [
    { name: 'Luna 9', lat: 7.08, lng: -64.37, date: '1966-02-03', who: 'Soviet Union', what: 'The first soft landing on another world, and the first photographs from the surface of the Moon.' },
    { name: 'Surveyor 1', lat: -2.474, lng: -43.339, date: '1966-06-02', who: 'NASA', what: 'The first American soft landing; it proved the ground would hold a spacecraft, clearing the way for Apollo.' },
    { name: 'Apollo 11', lat: 0.6741, lng: 23.4730, date: '1969-07-20', who: 'NASA', crew: 'Neil Armstrong, Buzz Aldrin', what: 'The first people on the Moon, in the Sea of Tranquility.' },
    { name: 'Apollo 12', lat: -3.0124, lng: -23.4216, date: '1969-11-19', who: 'NASA', crew: 'Pete Conrad, Alan Bean', what: 'A pinpoint landing 180 metres from the Surveyor 3 probe, whose parts they brought home.' },
    { name: 'Lunokhod 1', lat: 38.24, lng: -35.0, date: '1970-11-17', who: 'Soviet Union', what: 'The first robot rover on another world (carried by Luna 17); it drove 10.5 km.' },
    { name: 'Apollo 14', lat: -3.6453, lng: -17.4714, date: '1971-02-05', who: 'NASA', crew: 'Alan Shepard, Edgar Mitchell', what: 'The Fra Mauro highlands; Shepard hit two golf balls.' },
    { name: 'Apollo 15', lat: 26.1322, lng: 3.6339, date: '1971-07-30', who: 'NASA', crew: 'David Scott, James Irwin', what: 'The first Lunar Roving Vehicle, at the foot of the Apennine mountains beside Hadley Rille.' },
    { name: 'Apollo 16', lat: -8.9730, lng: 15.5002, date: '1972-04-21', who: 'NASA', crew: 'John Young, Charles Duke', what: 'The only Apollo landing in the central highlands.' },
    { name: 'Apollo 17', lat: 20.1908, lng: 30.7717, date: '1972-12-11', who: 'NASA', crew: 'Eugene Cernan, Harrison Schmitt', what: 'The last people on the Moon so far; Schmitt was the first scientist there.' },
    { name: 'Chang’e 3', lat: 44.12, lng: -19.51, date: '2013-12-14', who: 'China National Space Administration', what: 'China’s first landing, with the Yutu rover.' },
    { name: 'Chang’e 4', lat: -45.4446, lng: 177.5991, date: '2019-01-03', who: 'China National Space Administration', what: 'The first landing on the far side, in Von Kármán crater; its Yutu-2 rover is still driving.' },
    { name: 'Chang’e 5', lat: 43.06, lng: -51.92, date: '2020-12-01', who: 'China National Space Administration', what: 'Brought 1.7 kg of young volcanic rock back to Earth, the first lunar samples since 1976.' },
    { name: 'Chandrayaan-3', lat: -69.373, lng: 32.319, date: '2023-08-23', who: 'Indian Space Research Organisation', what: 'The first landing near the south pole; its Pragyan rover confirmed sulfur in the soil.' },
    { name: 'SLIM', lat: -13.316, lng: 25.251, date: '2024-01-19', who: 'Japan Aerospace Exploration Agency', what: 'Landed within 100 m of its target (on its nose), making Japan the fifth country to land on the Moon.' },
    { name: 'Odysseus (IM-1)', lat: -80.13, lng: 1.44, date: '2024-02-22', who: 'Intuitive Machines', what: 'The first private spacecraft to land on the Moon, and the farthest south yet.' },
    { name: 'Chang’e 6', lat: -41.625, lng: -153.978, date: '2024-06-01', who: 'China National Space Administration', what: 'The first rock samples from the far side, from the South Pole–Aitken basin.' },
    { name: 'Blue Ghost 1', lat: 18.56, lng: 61.81, date: '2025-03-02', who: 'Firefly Aerospace', what: 'The first fully successful private landing, in the Sea of Crises; it watched a sunset from the Moon.' },
  ],
  mars: [
    { name: 'Viking 1', lat: 22.27, lng: -47.95, date: '1976-07-20', who: 'NASA', what: 'The first successful landing on Mars; it worked for more than six years.' },
    { name: 'Viking 2', lat: 47.64, lng: 134.29, date: '1976-09-03', who: 'NASA', what: 'Photographed frost on the plains of Utopia Planitia.' },
    { name: 'Pathfinder', lat: 19.13, lng: -33.22, date: '1997-07-04', who: 'NASA', what: 'Bounced down on airbags and released Sojourner, the first rover on Mars.' },
    { name: 'Spirit', lat: -14.5684, lng: 175.4726, date: '2004-01-04', who: 'NASA', what: 'Found signs of ancient hot springs in Gusev crater; drove 7.7 km.' },
    { name: 'Opportunity', lat: -1.9462, lng: -5.5266, date: '2004-01-25', who: 'NASA', what: 'Planned for 90 days, it drove for 14 years and 45 km, the longest drive on another world.' },
    { name: 'Phoenix', lat: 68.22, lng: -125.75, date: '2008-05-25', who: 'NASA', what: 'Dug up water ice just under the surface of the far north.' },
    { name: 'Curiosity', lat: -4.5895, lng: 137.4417, date: '2012-08-06', who: 'NASA', what: 'Lowered by a rocket-powered sky crane into Gale crater; still climbing Mount Sharp.' },
    { name: 'InSight', lat: 4.502, lng: 135.623, date: '2018-11-26', who: 'NASA', what: 'Listened to more than 1,300 marsquakes and mapped the planet’s core.' },
    { name: 'Perseverance', lat: 18.4447, lng: 77.4508, date: '2021-02-18', who: 'NASA', what: 'Collecting rock samples in an ancient river delta in Jezero crater; it carried the Ingenuity helicopter, the first powered flight on another world.' },
    { name: 'Zhurong', lat: 25.066, lng: 109.925, date: '2021-05-15', who: 'China National Space Administration', what: 'China’s first Mars rover (Tianwen-1), on Utopia Planitia.' },
  ],
};
