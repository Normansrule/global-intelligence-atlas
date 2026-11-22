// SPDX-License-Identifier: AGPL-3.0-only
// v2.33 Companies and countries in the news (site/app/js/newsangles.js): which headlines count as about a company or
// a country, which angle each takes, and that state-controlled outlets are left out.
import { anglesOf, nameMatcher, companyNames, credible, storiesAbout, byAngle, placesIn, wherePlaces, storiesHtml, storiesSummary, leadAngle } from '../../site/app/js/newsangles.js';
import { PUBLISHERS } from '../../site/app/js/newslist.js';
const res = [];
const check = (n, ok, info = '') => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : JSON.stringify(info)); };
const PUB = Object.fromEntries(PUBLISHERS.map((p) => [p.key, p]));
const at = (h) => new Date(Date.parse('2026-11-18T12:00:00Z') - h * 3600e3).toISOString();
const H = [
  { t: 'Apple shares fall after iPhone sales slow in China', u: 'https://bbc.com/1', at: at(1), p: 'bbc' },
  { t: 'EU regulators fine Apple over App Store rules', u: 'https://theguardian.com/2', at: at(2), p: 'guardian' },
  { t: 'Tim Cook meets the president at the White House', u: 'https://npr.org/3', at: at(3), p: 'npr' },
  { t: 'Apple orchards hit by late frost', u: 'https://bbc.com/4', at: at(4), p: 'bbc' },
  { t: 'Pineapple prices rise in Ghana', u: 'https://bbc.com/5', at: at(5), p: 'bbc' },
  { t: 'Apple wins appeal in Brussels court', u: 'https://aljazeera.com/6', at: at(6), p: 'aljazeera' },
  { t: 'Amazon fires spread as drought deepens in Brazil', u: 'https://dw.com/7', at: at(7), p: 'dw' },
  { t: 'Amazon cuts 14,000 jobs as AI spending grows', u: 'https://cbc.ca/8', at: at(8), p: 'cbc' },
  { t: 'Apple shares fall after iPhone sales slow in China', u: 'https://bbc.com/1', at: at(1), p: 'bbc' },
  { t: 'Russian drones strike Kyiv overnight', u: 'https://kyivindependent.com/9', at: at(9), p: 'kyivindependent' },
];
const ok = credible(H, PUB);
check('state-controlled outlets are left out (Al Jazeera), public and commercial kept', ok.length === H.length - 1 && !ok.some((h) => h.p === 'aljazeera'));
check('unknown publishers and items without a link are left out', credible([{ t: 'x', u: 'https://a', p: 'nobody' }, { t: 'y', p: 'bbc' }], PUB).length === 0);
const apple = storiesAbout(ok, companyNames({ id: 'apple', company: 'Apple' }));
check('Apple: three stories, by name, by product and by its chief executive, newest first, one per link', apple.length === 3 && apple[0].u.endsWith('/1') && apple.map((s) => s.u.slice(-1)).join('') === '123', apple.map((s) => s.t));
check('whole words only: pineapple is not Apple', !apple.some((s) => /Pineapple/.test(s.t)));
check('words that mean the fruit rule a headline out (orchards)', !apple.some((s) => /orchards/.test(s.t)));
const amazon = storiesAbout(ok, companyNames({ id: 'amazon', company: 'Amazon' }));
check('Amazon the company, not the rainforest (drought, fires)', amazon.length === 1 && amazon[0].u.endsWith('/8'), amazon.map((s) => s.t));
check('angles: shares and sales are economy; regulators fining is courts and regulation; the White House is politics', anglesOf(H[0].t)[0] === 'economy' && anglesOf(H[1].t)[0] === 'law' && anglesOf(H[2].t)[0] === 'politics', [anglesOf(H[0].t), anglesOf(H[1].t), anglesOf(H[2].t)]);
check('at most two angles each, the first word in the title leading', anglesOf('Election ends with market rally after court ruling').join() === 'politics,economy');
check('a title with no angle words is "other"', anglesOf('Fresh look at an old house')[0] === 'other');
check('drones striking Kyiv is conflict', anglesOf(H[9].t)[0] === 'conflict');
const g = byAngle(apple);
check('grouped by first angle in a fixed order', g.map(([id]) => id).join() === 'politics,economy,law', g.map(([id]) => id));
const C = [{ cc: 'CN', name: 'China' }, { cc: 'BR', name: 'Brazil' }, { cc: 'UA', name: 'Ukraine' }, { cc: 'RU', name: 'Russia' }, { cc: 'US', name: 'United States of America' }, { cc: 'NE', name: 'Niger' }, { cc: 'NG', name: 'Nigeria' }];
check('places by name, by demonym and by capital (Kyiv is Ukraine; Russian is Russia)', placesIn(H[9].t, C).map((p) => p.cc).sort().join() === 'RU,UA', placesIn(H[9].t, C));
check('Niger is not Nigeria', placesIn('Floods in Nigeria', C).map((p) => p.cc).join() === 'NG');
check('the White House counts as the United States', placesIn('Tim Cook at the White House in Washington', C).map((p) => p.cc).join() === 'US');
const w = wherePlaces(apple, C, 'US');
check('where Apple’s stories are: China, with its home country skipped', w.length === 1 && w[0].cc === 'CN' && w[0].n === 1, w);
const html = storiesHtml(apple, PUB, Date.parse('2026-11-18T12:00:00Z'));
check('story links open the publisher in a new tab without passing the opener', (html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length === 3);
check('titles are escaped', !storiesHtml([{ t: '<img src=x>', u: 'https://bbc.com/x', at: at(1), p: 'bbc', angles: ['other'] }], PUB).includes('<img'));
check('the summary counts stories, publishers and angles', storiesSummary(apple, PUB) === '3 stories from 3 publishers: politics 1, economy 1, courts 1', storiesSummary(apple, PUB));
check('NVIDIA is matched as Nvidia, IBM stays IBM', storiesAbout([{ t: 'Nvidia earnings beat forecasts', u: 'https://cbc.ca/n', at: at(1), p: 'cbc' }], companyNames({ id: 'nvidia', company: 'NVIDIA' })).length === 1 && !companyNames({ id: 'ibm', company: 'IBM' }).names.includes('Ibm'));
check('a name matcher with no names matches nothing', nameMatcher([])('Anything') === false);
// v2.35: a country's colour on the globe is the angle most of its stories take, not the first angle in the list
const ru = ['Russian drones strike Kyiv overnight', 'Ukraine and Russia agree prisoner swap', 'Kremlin rejects ceasefire plan'].map((t) => ({ t, angles: anglesOf(t) }));
check('leadAngle: the angle most stories take wins (conflict 3, politics 1)', leadAngle(ru) === 'conflict' && leadAngle([]) === 'other', ru.map((s) => s.angles));
console.log(`SUMMARY ${res.filter(Boolean).length} / ${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
