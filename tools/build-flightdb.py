#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the offline flight reference tables from Virtual Radar Server's standing data (CC0, public domain).

    git clone --depth 1 https://github.com/vradarserver/standing-data.git /tmp/standing-data
    python3 tools/build-flightdb.py /tmp/standing-data

Writes site/app/data/flightdb/:
  airlines.json   {"BAW": ["British Airways", "BA"], ...}                   ICAO airline code -> name, IATA code
  types.json      {"B77W": ["Boeing", "777-300ER", "2J", "H", ""], ...}     ICAO type designator -> maker, model, engines, wake, engine placement (A = aft)
  blocks.json     [[start, end, "GB", 0], ...]                              ICAO 24-bit address blocks -> country, military
  countries.json  {"GB": "United Kingdom", ...}
  airports.json   {"fields": [...], "rows": [[icao, iata, name, city, cc, lat, lng], ...]}  airports used by the routes
  routes/XXX.json {"117": "0-1", ...}                                       per airline: flight number -> airport indexes
  from/E.json     {"EGLL": [[12, 40, "BAW VIR"], ...]}                       per airport: nonstop legs out (destination, flight numbers, airlines)
Routes are the published schedules users of Virtual Radar Server have entered for each callsign, so they are the
planned route of that flight number, not a filed flight plan for today.
"""
import csv, glob, json, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/standing-data'
OUT = os.path.join(os.path.dirname(__file__), '..', 'site', 'app', 'data', 'flightdb')
os.makedirs(os.path.join(OUT, 'routes'), exist_ok=True)
rd = lambda p: csv.DictReader(open(p, encoding='utf-8-sig'))
dump = lambda name, obj: json.dump(obj, open(os.path.join(OUT, name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

airlines = {}
for r in rd(f'{SRC}/airlines/schema-01/airlines.csv'):
    if re.fullmatch(r'[A-Z]{3}', r['ICAO'] or '') and r['ICAO'] not in airlines:
        airlines[r['ICAO']] = [r['Name'].strip(), r['IATA'] or '']
dump('airlines.json', airlines)

# Common names for frequent types whose standing-data rows are mostly variant or military names.
NAMES = {'E135': ('Embraer', 'ERJ 135'), 'E145': ('Embraer', 'ERJ 145'), 'E45X': ('Embraer', 'ERJ 145XR'), 'CRJ1': ('Bombardier', 'CRJ100'),
  'CRJ2': ('Bombardier', 'CRJ200'), 'CRJ7': ('Bombardier', 'CRJ700'), 'CRJ9': ('Bombardier', 'CRJ900'), 'CRJX': ('Bombardier', 'CRJ1000'),
  'C130': ('Lockheed', 'C-130 Hercules'), 'C30J': ('Lockheed Martin', 'C-130J Super Hercules'), 'C17': ('Boeing', 'C-17 Globemaster III'),
  'C172': ('Cessna', '172 Skyhawk'), 'C182': ('Cessna', '182 Skylane'), 'C152': ('Cessna', '152'), 'C208': ('Cessna', '208 Caravan'),
  'P28A': ('Piper', 'PA-28 Cherokee'), 'SR22': ('Cirrus', 'SR22'), 'PC12': ('Pilatus', 'PC-12'), 'B350': ('Beechcraft', 'King Air 350'),
  'BE20': ('Beechcraft', 'King Air 200'), 'B190': ('Beechcraft', '1900'), 'DH8A': ('De Havilland Canada', 'Dash 8-100'),
  'DH8B': ('De Havilland Canada', 'Dash 8-200'), 'DH8C': ('De Havilland Canada', 'Dash 8-300'), 'DH8D': ('De Havilland Canada', 'Dash 8-400'),
  'DHC6': ('De Havilland Canada', 'DHC-6 Twin Otter'), 'AT43': ('ATR', 'ATR 42-300'), 'AT45': ('ATR', 'ATR 42-500'), 'AT46': ('ATR', 'ATR 42-600'),
  'AT72': ('ATR', 'ATR 72'), 'AT75': ('ATR', 'ATR 72-500'), 'AT76': ('ATR', 'ATR 72-600'), 'SF34': ('Saab', '340'), 'JS41': ('BAE Systems', 'Jetstream 41'),
  'A139': ('Leonardo', 'AW139'), 'A169': ('Leonardo', 'AW169'), 'EC35': ('Airbus Helicopters', 'H135'), 'EC45': ('Airbus Helicopters', 'H145'),
  'AS50': ('Airbus Helicopters', 'H125 (AS350)'), 'S76': ('Sikorsky', 'S-76'), 'S92': ('Sikorsky', 'S-92'), 'R44': ('Robinson', 'R44'), 'R22': ('Robinson', 'R22'),
  'GLF4': ('Gulfstream', 'G-IV'), 'GLF5': ('Gulfstream', 'G-V'), 'GLF6': ('Gulfstream', 'G650'), 'GL5T': ('Bombardier', 'Global 5000'),
  'GLEX': ('Bombardier', 'Global Express'), 'GL7T': ('Bombardier', 'Global 7500'), 'CL30': ('Bombardier', 'Challenger 300'), 'CL35': ('Bombardier', 'Challenger 350'),
  'CL60': ('Bombardier', 'Challenger 600 series'), 'C68A': ('Cessna', 'Citation Latitude'), 'C700': ('Cessna', 'Citation Longitude'), 'C56X': ('Cessna', 'Citation Excel'),
  'C25A': ('Cessna', 'Citation CJ2'), 'C25B': ('Cessna', 'Citation CJ3'), 'C25C': ('Cessna', 'Citation CJ4'), 'E55P': ('Embraer', 'Phenom 300'), 'E50P': ('Embraer', 'Phenom 100'),
  'PC24': ('Pilatus', 'PC-24'), 'FA7X': ('Dassault', 'Falcon 7X'), 'FA8X': ('Dassault', 'Falcon 8X'), 'F2TH': ('Dassault', 'Falcon 2000'), 'F900': ('Dassault', 'Falcon 900'),
  'LJ45': ('Learjet', '45'), 'LJ75': ('Learjet', '75'), 'B463': ('BAE Systems', '146-300'), 'RJ85': ('Avro', 'RJ85'), 'RJ1H': ('Avro', 'RJ100'),
  'MD11': ('McDonnell Douglas', 'MD-11'), 'MD82': ('McDonnell Douglas', 'MD-82'), 'MD83': ('McDonnell Douglas', 'MD-83'), 'MD88': ('McDonnell Douglas', 'MD-88'),
  'MD90': ('McDonnell Douglas', 'MD-90'), 'DC10': ('McDonnell Douglas', 'DC-10'), 'B722': ('Boeing', '727-200'), 'B762': ('Boeing', '767-200'), 'B764': ('Boeing', '767-400ER'),
  'B753': ('Boeing', '757-300'), 'B773': ('Boeing', '777-300'), 'B77F': ('Boeing', '777 Freighter'), 'B74F': ('Boeing', '747-400 Freighter'), 'B748': ('Boeing', '747-8'),
  'A306': ('Airbus', 'A300-600'), 'A310': ('Airbus', 'A310'), 'A342': ('Airbus', 'A340-200'), 'A343': ('Airbus', 'A340-300'), 'A346': ('Airbus', 'A340-600'),
  'A3ST': ('Airbus', 'Beluga'), 'A400': ('Airbus', 'A400M Atlas'), 'K35R': ('Boeing', 'KC-135 Stratotanker'), 'A124': ('Antonov', 'An-124 Ruslan'),
  'IL76': ('Ilyushin', 'Il-76'), 'SU95': ('Sukhoi', 'Superjet 100'), 'ARJ21': ('COMAC', 'ARJ21'), 'F100': ('Fokker', '100'), 'F70': ('Fokker', '70'), 'F50': ('Fokker', '50'), 'DA42': ('Diamond', 'DA42 Twin Star'), 'DA40': ('Diamond', 'DA40 Diamond Star'), 'PA34': ('Piper', 'PA-34 Seneca'), 'PA31': ('Piper', 'PA-31 Navajo'), 'B06': ('Bell', '206 JetRanger'), 'B407': ('Bell', '407'), 'BE58': ('Beechcraft', 'Baron 58'), 'BE36': ('Beechcraft', 'Bonanza 36'), 'TBM9': ('Daher', 'TBM 910'), 'M20P': ('Mooney', 'M20')}
types = {}; makers = {}
for f in sorted(glob.glob(f'{SRC}/model-type/schema-01/*.csv')):
    for r in rd(f):
        code = r['ICAO']
        if not code or code.startswith('-'): continue
        m = makers.setdefault(code, {}); m[r['Manufacturer'].strip()] = m.get(r['Manufacturer'].strip(), 0) + 1
        model = r['Model'].strip()
        military = re.fullmatch(r'[A-Z]{1,2}-\d+[A-Z]?|.* [A-Z]-\d+|[A-Z]{1,2}-\d+[A-Z]? .*', model) and not model.startswith('CL-')  # C-99, ATR P-72, EC-130 Aya
        score = (not military, r['IsActive'] == '1', not re.search(r'Prestige|ACJ|BBJ|VIP|Freighter|\(', model), -len(model))
        if code not in types or score > types[code][0]:
            types[code] = (score, [r['Manufacturer'].strip(), model, f"{r['Engines']}{r['EngineTypeCode']}", r['WakeTurbulenceCode'], r['EnginePlacementCode']])
for code, (_, row) in types.items():
    m = makers[code]; top = max(m, key=m.get)
    if m[top] > m.get(row[0], 0): row[0] = top  # the maker most rows agree on (Cessna, not a licence builder)
    if code in NAMES: row[0], row[1] = NAMES[code]
dump('types.json', {k: v[1] for k, v in sorted(types.items())})

blocks = []
for r in rd(f'{SRC}/code-blocks/schema-01/code-blocks.csv'):
    if r['CountryISO2'] == 'ZZ' and r['IsMilitary'] == '0': continue
    blocks.append([int(r['Start'], 16), int(r['Finish'], 16), r['CountryISO2'], int(r['IsMilitary'])])
blocks.sort(key=lambda b: (b[1] - b[0], b[0]))  # most specific block first
dump('blocks.json', blocks)
dump('countries.json', {r['ISO']: r['Name'] for r in rd(f'{SRC}/countries/schema-01/countries.csv')})

apt = {}
for f in glob.glob(f'{SRC}/airports/schema-01/*/*.csv'):
    for r in rd(f):
        if r['ICAO'] and r['Latitude']:
            apt[r['ICAO']] = [r['ICAO'], r['IATA'] or '', r['Name'].strip(), (r['Location'] or '').strip(), r['CountryISO2'], round(float(r['Latitude']), 4), round(float(r['Longitude']), 4)]
routes = {}; used = {}
for f in glob.glob(f'{SRC}/routes/schema-01/*/*.csv'):
    for r in rd(f):
        code = r['AirlineCode'] or r['Code']; num = r['Number']; chain = r['AirportCodes'].split('-')
        if not re.fullmatch(r'[A-Z]{3}', code or '') or len(chain) < 2 or any(a not in apt for a in chain): continue
        idx = []
        for a in chain:
            if a not in used: used[a] = len(used)
            idx.append(used[a])
        routes.setdefault(code, {})[num] = '-'.join(format(i, 'x') for i in idx)
dump('airports.json', {'fields': ['icao', 'iata', 'name', 'city', 'cc', 'lat', 'lng'], 'rows': [apt[a] for a in sorted(used, key=used.get)]})
for old in glob.glob(os.path.join(OUT, 'routes', '*.json')): os.remove(old)
for code, m in routes.items(): dump(f'routes/{code}.json', m)
# Per airport, every scheduled nonstop leg out of it: [destination index, flight numbers, up to four airlines by count].
legs = {}
for code, m in routes.items():
    for chain in m.values():
        idx = [int(x, 16) for x in chain.split('-')]
        for a, b in zip(idx, idx[1:]):
            al = legs.setdefault(a, {}).setdefault(b, {}); al[code] = al.get(code, 0) + 1
rows = sorted(used, key=used.get)
os.makedirs(os.path.join(OUT, 'from'), exist_ok=True)
for old in glob.glob(os.path.join(OUT, 'from', '*.json')): os.remove(old)
shards = {}
for a, dests in legs.items():
    icao = rows[a]
    shards.setdefault(icao[0], {})[icao] = sorted(([b, sum(al.values()), ' '.join(sorted(al, key=lambda k: -al[k])[:4])] for b, al in dests.items()), key=lambda r: -r[1])
for k, v in shards.items(): dump(f'from/{k}.json', v)
print(f'{len(airlines)} airlines, {len(types)} types, {len(blocks)} address blocks, {len(used)} airports, '
      f'{sum(len(m) for m in routes.values())} routes in {len(routes)} airline files')
