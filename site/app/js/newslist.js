// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas: the publishers and broadcasters behind the News tab (newsdesk.js), shared with
// tools/fetch-news.mjs (which checks and reads them), sources.js (credits) and tools/build-references.py (APA).
// Baseline: World Monitor's feed list (src/config/feeds.ts) and live news panel (src/config/live-video-sources.ts).
//
// Rules for adding one:
//  - Headlines come only from a publisher's own RSS or Atom feed (no aggregators or redirect links). Only the title,
//    link, time and publisher are kept; the story is read on the publisher's site.
//  - Live channels play only through the broadcaster's own YouTube live stream (embedding is the broadcaster's
//    setting, checked every run) or an HLS stream on the broadcaster's own host that browsers may read (open
//    Cross-Origin Resource Sharing). No relays, re-streams, FAST-platform copies or spoofed requests.
//  - owner: 'public' (publicly funded, independent governance), 'state' (government-controlled or state-funded
//    without independent governance) or 'commercial'. Shown next to every headline and channel, as World Monitor does.
//  - Channels under sanctions or broadcast bans in the European Union, the UK or the U.S. are left out.

export const REGIONS = [
  ['world', 'World'], ['americas', 'Americas'], ['europe', 'Europe'], ['africa', 'Africa'],
  ['mideast', 'Middle East'], ['asia', 'Asia'], ['oceania', 'Oceania'],
];

export const OWNERS = {
  public: 'Public broadcaster or publisher',
  state: 'State-controlled or state-funded',
  commercial: 'Commercial',
  intergov: 'Intergovernmental organisation',
};

/** Publishers: key, name, owner, home page, country, and their feeds (region, url). author is the APA author. */
export const PUBLISHERS = [
  { key: 'bbc', name: 'BBC News', author: 'BBC News', owner: 'public', country: 'United Kingdom', home: 'https://www.bbc.com/news', feeds: [
    ['world', 'https://feeds.bbci.co.uk/news/world/rss.xml'], ['africa', 'https://feeds.bbci.co.uk/news/world/africa/rss.xml'],
    ['asia', 'https://feeds.bbci.co.uk/news/world/asia/rss.xml'], ['europe', 'https://feeds.bbci.co.uk/news/world/europe/rss.xml'],
    ['americas', 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml'], ['mideast', 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml'],
    ['americas', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml']] },
  { key: 'guardian', name: 'The Guardian', author: 'The Guardian', owner: 'commercial', country: 'United Kingdom', home: 'https://www.theguardian.com/world', feeds: [
    ['world', 'https://www.theguardian.com/world/rss']] },
  { key: 'dw', name: 'DW (Deutsche Welle)', author: 'Deutsche Welle', owner: 'public', country: 'Germany', home: 'https://www.dw.com/en', feeds: [
    ['world', 'https://rss.dw.com/xml/rss-en-all']] },
  { key: 'france24', name: 'France 24', author: 'France 24', owner: 'public', country: 'France', home: 'https://www.france24.com/en/', feeds: [
    ['world', 'https://www.france24.com/en/rss']] },
  { key: 'npr', name: 'NPR (National Public Radio)', author: 'NPR', owner: 'public', country: 'United States', home: 'https://www.npr.org/sections/world/', feeds: [
    ['world', 'https://feeds.npr.org/1004/rss.xml']] },
  { key: 'cbc', name: 'CBC News (Canadian Broadcasting Corporation)', author: 'CBC News', owner: 'public', country: 'Canada', home: 'https://www.cbc.ca/news/world', feeds: [
    ['americas', 'https://www.cbc.ca/cmlink/rss-world']] },
  { key: 'mercopress', name: 'MercoPress', author: 'MercoPress', owner: 'commercial', country: 'Uruguay', home: 'https://en.mercopress.com', feeds: [
    ['americas', 'https://en.mercopress.com/rss/']] },
  { key: 'aljazeera', name: 'Al Jazeera English', author: 'Al Jazeera', owner: 'state', country: 'Qatar', home: 'https://www.aljazeera.com', feeds: [
    ['mideast', 'https://www.aljazeera.com/xml/rss/all.xml']] },
  { key: 'africanews', name: 'Africanews', author: 'Africanews', owner: 'commercial', country: 'Republic of the Congo', home: 'https://www.africanews.com', feeds: [
    ['africa', 'https://www.africanews.com/feed/rss']] },
  { key: 'thehindu', name: 'The Hindu', author: 'The Hindu', owner: 'commercial', country: 'India', home: 'https://www.thehindu.com/news/international/', feeds: [
    ['asia', 'https://www.thehindu.com/news/international/feeder/default.rss']] },
  { key: 'cna', name: 'CNA (Channel NewsAsia)', author: 'CNA', owner: 'state', country: 'Singapore', home: 'https://www.channelnewsasia.com', feeds: [
    ['asia', 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311']] },
  { key: 'japantimes', name: 'The Japan Times', author: 'The Japan Times', owner: 'commercial', country: 'Japan', home: 'https://www.japantimes.co.jp', feeds: [
    ['asia', 'https://www.japantimes.co.jp/feed/']] },
  { key: 'kyivindependent', name: 'The Kyiv Independent', author: 'The Kyiv Independent', owner: 'commercial', country: 'Ukraine', home: 'https://kyivindependent.com', feeds: [
    ['europe', 'https://kyivindependent.com/news-archive/rss/']] },
  { key: 'abcau', name: 'ABC News (Australian Broadcasting Corporation)', author: 'Australian Broadcasting Corporation', owner: 'public', country: 'Australia', home: 'https://www.abc.net.au/news', feeds: [
    ['oceania', 'https://www.abc.net.au/news/feed/51120/rss.xml'], ['world', 'https://www.abc.net.au/news/feed/2942460/rss.xml']] },
  { key: 'rnz', name: 'RNZ (Radio New Zealand)', author: 'RNZ', owner: 'public', country: 'New Zealand', home: 'https://www.rnz.co.nz/news/world', feeds: [
    ['oceania', 'https://www.rnz.co.nz/rss/pacific.xml'], ['world', 'https://www.rnz.co.nz/rss/world.xml']] },
  { key: 'unnews', name: 'UN News (United Nations)', author: 'United Nations', owner: 'intergov', country: 'International', home: 'https://news.un.org/en/', feeds: [
    ['world', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml']] },
];

/**
 * Live channels: key, name, owner, region, language, the broadcaster's YouTube channel id (yt), a known live video
 * id to try if the channel page cannot be read (video), and HLS streams on the broadcaster's own host (hls).
 * tools/fetch-news.mjs checks each one and writes what plays to channels.json.
 */
export const CHANNELS = [
  { key: 'aljazeera', name: 'Al Jazeera English', author: 'Al Jazeera English', owner: 'state', region: 'mideast', lang: 'en', yt: 'UCNye-wNBqNL5ZzHSJj3l8Bg', video: 'gCNeDWCI0vo', hls: ['https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8'] },
  { key: 'dw', name: 'DW News', author: 'DW News', owner: 'public', region: 'europe', lang: 'en', yt: 'UCknLrEdhRCp1aegoMqRaCZg', video: 'LuKwFajn37U', hls: ['https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/master.m3u8'] },
  { key: 'france24', name: 'France 24 English', author: 'FRANCE 24 English', owner: 'public', region: 'europe', lang: 'en', yt: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', video: 'HvZt-nh9sGg', hls: [] },
  { key: 'euronews', name: 'Euronews', author: 'euronews', owner: 'commercial', region: 'europe', lang: 'en', yt: 'UCSrZ3UV4jOidv8ppoVuvW9Q', video: 'pykpO5kQJ98', hls: [] },
  { key: 'sky', name: 'Sky News', author: 'Sky News', owner: 'commercial', region: 'europe', lang: 'en', yt: 'UCoMdktPbSTixAyNGwb-UYkQ', video: 'xDWQ3LkccY8', hls: [] },
  { key: 'bloomberg', name: 'Bloomberg Television', author: 'Bloomberg Television', owner: 'commercial', region: 'americas', lang: 'en', yt: 'UCIALMKvObZNtJ6AmdCLP7Lg', video: 'QB5BNdBFujE', hls: [] },
  { key: 'abcus', name: 'ABC News Live (U.S.)', author: 'ABC News', owner: 'commercial', region: 'americas', lang: 'en', yt: 'UCBi2mrWuNuyYy4gbM6fU18Q', hls: [] },
  { key: 'nbc', name: 'NBC News NOW', author: 'NBC News', owner: 'commercial', region: 'americas', lang: 'en', yt: 'UCeY0bbntWzzVIaj2z3QigXg', hls: [] },
  { key: 'cbsnews', name: 'CBS News 24/7', author: 'CBS News', owner: 'commercial', region: 'americas', lang: 'en', hls: ['https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8'] },
  { key: 'cbc', name: 'CBC News', author: 'CBC News', owner: 'public', region: 'americas', lang: 'en', yt: 'UCuFFtHWoLl5fauMMD5Ww2jA', hls: [] },
  { key: 'africanews', name: 'Africanews', author: 'africanews', owner: 'commercial', region: 'africa', lang: 'en', yt: 'UC1_E8NeF5QHY2dtdLRBCCLA', hls: [] },
  { key: 'channelstv', name: 'Channels Television', author: 'Channels Television', owner: 'commercial', region: 'africa', lang: 'en', yt: 'UCEXGDNclvmg6RW0vipJYsTQ', hls: [] },
  { key: 'arise', name: 'Arise News', author: 'Arise News', owner: 'commercial', region: 'africa', lang: 'en', yt: 'UCyEJX-kSj0kOOCS7Qlq2G7g', hls: [] },
  { key: 'trtworld', name: 'TRT World', author: 'TRT World', owner: 'state', region: 'mideast', lang: 'en', hls: ['https://tv-trtworld.medya.trt.com.tr/master.m3u8'] },
  { key: 'nhk', name: 'NHK World-Japan', author: 'NHK World-Japan', owner: 'public', region: 'asia', lang: 'en', yt: 'UCSPEjw8F2nQDtmUKPFNF7_A', hls: ['https://masterpl.hls.nhkworld.jp/hls/w/live/master.m3u8'] },
  { key: 'cna', name: 'CNA (Channel NewsAsia)', author: 'CNA', owner: 'state', region: 'asia', lang: 'en', yt: 'UC83jt4dlz1Gjl58fzQrrHZg', video: 'XWq5kBlakcQ', hls: [] },
  { key: 'wion', name: 'WION (World Is One News)', author: 'WION', owner: 'commercial', region: 'asia', lang: 'en', yt: 'UC_gUM8rL-Lrg6O3adPW9K1g', video: 'X-7LAkvfA5s', hls: [] },
  { key: 'cgtn', name: 'CGTN (China Global Television Network)', author: 'CGTN', owner: 'state', region: 'asia', lang: 'en', video: '0i7n3r01L2U', hls: ['https://english-livebkali.cgtn.com/live/encgtn.m3u8'] },
  { key: 'arirang', name: 'Arirang News', author: 'Arirang News', owner: 'state', region: 'asia', lang: 'en', hls: ['https://amdlive-ch01-ctnd-com.akamaized.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8'] },
  { key: 'abcau', name: 'ABC News (Australia)', author: 'ABC News (Australia)', owner: 'public', region: 'oceania', lang: 'en', yt: 'UCVgO39Bk5sMo66-6o6Spn6Q', video: 'vOTiJkg1voo', hls: [] },
  { key: 'tagesschau', name: 'tagesschau24 (ARD)', author: 'ARD', owner: 'public', region: 'europe', lang: 'de', hls: ['https://tagesschau.akamaized.net/hls/live/2020115/tagesschau/tagesschau_1/master.m3u8'] },
  { key: 'rtve24h', name: 'Canal 24 Horas (RTVE)', author: 'RTVE', owner: 'public', region: 'europe', lang: 'es', hls: ['https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8'] },
];
