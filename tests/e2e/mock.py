# Playwright request mocks for the Global Intelligence Atlas end-to-end tests. MOCK_REAL=1 serves the recorded
# live-data snapshot in fixtures/; MOCK_CORS=1 makes flight and orbit hosts fail as a browser without CORS would.
import json, random, time, os
SP=os.path.dirname(os.path.abspath(__file__))
random.seed(3); now=int(time.time()*1000)
TLE=open(os.path.join(SP,'tle-fresh.txt')).read()
def quakes(n, days):
    places=["45 km SW of Hualien, Taiwan","Kermadec Islands","120 km E of Kuril'sk, Russia","offshore Valparaíso, Chile","Tonga","near Honshu, Japan","Aleutian Islands, Alaska","Sumatra, Indonesia"]
    feats=[]
    for i in range(n):
        lat,lng = random.choice([(24,122),(-30,-178),(45,148),(-33,-72),(-20,-175),(37,142),(52,-170),(0,97)])
        feats.append({"id":f"q{i}","properties":{"mag":round(random.uniform(2.5,6.8),1),"place":random.choice(places),"time":now-random.randint(0,days*86400000),"url":"https://earthquake.usgs.gov","magType":"mww","felt":3,"tsunami":0},"geometry":{"coordinates":[lng+random.uniform(-4,4),lat+random.uniform(-4,4),random.uniform(5,400)]}})
    return json.dumps({"features":feats})
EONET=json.dumps({"events":[{"id":"E1","title":"Wildfire - Butte County, California","categories":[{"id":"wildfires","title":"Wildfires"}],"geometry":[{"type":"Point","date":"2026-09-26T10:00:00Z","coordinates":[-121.6,39.7]}],"sources":[]}]})
GDELT=json.dumps({"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"London, United Kingdom","count":25,"html":'<a href="https://example.com/1" title="Headline about London">x</a>'},"geometry":{"type":"Point","coordinates":[-0.12,51.5]}}]})
def iso(ms): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ms/1000))
LL2=json.dumps({"results":[{"id":f"L{i}","name":n,"net":iso(now+h*3600000),"status":{"name":"Go for Launch","abbrev":"Go"},"probability":90,"webcast_live":i==0,"image":"","pad":{"name":p,"latitude":str(la),"longitude":str(lo),"location":{"name":s}},"rocket":{"configuration":{"name":r,"full_name":r}},"mission":{"name":n.split('|')[-1].strip(),"description":"Deploys a batch of satellites.","type":"Communications","orbit":{"name":"Low Earth Orbit"}},"launch_service_provider":{"name":"SpaceX","type":"Commercial"},"vidURLs":[{"title":"Webcast","url":"https://www.youtube.com/watch?v=x","live":i==0}],"infoURLs":[]} for i,(n,h,p,la,lo,s,r) in enumerate([("Falcon 9 | Starlink 12-5",-0.2,"SLC-40",28.56,-80.58,"Cape Canaveral SFS, FL, USA","Falcon 9 Block 5"),("Electron | Mission X",5,"LC-1B",-39.26,177.86,"Rocket Lab Launch Complex 1, NZ","Electron"),("Long March 5 | Tianzhou",30,"LC-101",19.61,110.95,"Wenchang, China","Long March 5"),("Ariane 6 | Galileo",80,"ELA-4",5.24,-52.77,"Kourou, French Guiana","Ariane 64")])]})
GDACS=json.dumps({"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[130.2,21.4]},"properties":{"eventtype":"TC","eventid":1001,"name":"Tropical Cyclone NEOGURI-26","description":"Tropical Cyclone NEOGURI-26","alertlevel":"Red","alertscore":3,"country":"Philippines","fromdate":"2026-09-25T00:00:00","todate":"2026-09-28T12:00:00","severitydata":{"severitytext":"Category 4 — 220 km/h"},"glide":"TC-2026-000123-PHL","url":{"report":"https://www.gdacs.org/report.aspx?eventid=1001&eventtype=TC"}}},{"type":"Feature","geometry":{"type":"Point","coordinates":[105.2,29.3]},"properties":{"eventtype":"EQ","eventid":1562260,"name":"Earthquake in China","alertlevel":"Orange","alertscore":2,"country":"China","fromdate":"2026-09-27T05:13:35","todate":"2026-09-27T05:13:35","severitydata":{"severitytext":"Magnitude 5.9M, Depth:10km"}}}]})
OSKY=json.dumps({"time":now//1000,"states":[[f"a{i:05x}",f"TST{i} ","United States",0,0,random.uniform(-125,-70) if i<800 else random.uniform(-180,180),random.uniform(25,50) if i<800 else random.uniform(-55,65),random.uniform(1000,12000),False,random.uniform(150,260),random.uniform(0,360),0,None,random.uniform(1000,12000),"1200",False,0] for i in range(4000)]})
_os=json.loads(OSKY)
SNAP=json.dumps({"generatedAt":iso(now-7*60000),"src":"OpenSky Network (worldwide, API client)","fields":['id','call','lat','lng','altFt','ground','kt','trk','vs','squawk','type','reg'],
  "ac":[[s[0],s[1].strip(),round(s[6],3),round(s[5],3),round(s[13]*3.281),0,round(s[9]*1.944),round(s[10]),0,'7700' if i==5 else '1200',None,None] for i,s in enumerate(_os['states'])]})
CORS_REAL=os.environ.get('MOCK_CORS')=='1'
_types=[70,80,60,36,30,52,71,84]
AIS_LOC=json.dumps({"features":[{"mmsi":230000000+i,"geometry":{"coordinates":[24.5+random.uniform(-1.2,1.2),59.9+random.uniform(-0.3,0.3)]},"properties":{"mmsi":230000000+i,"sog":random.choice([0,8,12]),"cog":random.uniform(0,360),"heading":0,"navStat":0}} for i in range(160)]})
AIS_VES=json.dumps([{"mmsi":230000000+i,"name":f"VESSEL {i}","shipType":_types[i%len(_types)],"destination":"HELSINKI"} for i in range(160)])
_cats=['THEFT','BATTERY','BURGLARY','MOTOR VEHICLE THEFT','NARCOTICS','CRIMINAL DAMAGE','DECEPTIVE PRACTICE','ROBBERY']
CHI=json.dumps([{"date":"2026-09-20T10:00:00","primary_type":_cats[i%8],"description":"TEST","block":"0000X N STATE ST","location_description":"STREET","arrest":False,"latitude":41.88+random.uniform(-0.02,0.02),"longitude":-87.63+random.uniform(-0.02,0.02)} for i in range(300)])
REAL=os.path.join(SP,'fixtures')  # recorded live-data snapshot files (flights, GDACS, news, orbits)
USE_REAL=os.environ.get('MOCK_REAL')=='1'
def real_snapshot(name):
    p=os.path.join(REAL,name)
    if not os.path.exists(p): return None
    b=open(p,'rb').read()
    if name=='flights.json':  # pretend it was taken 4 minutes ago
        j=json.loads(b); j['generatedAt']=iso(int(time.time()*1000)-4*60000); b=json.dumps(j)
    return b
# v2.1: fire hotspots, radar, live-data status and the aircraft type table
FIRES=json.dumps({"generatedAt":iso(now-12*60000),"src":"NASA FIRMS · VIIRS NOAA-20, global 24 hours","fields":['lat','lng','frp','conf','t','day'],
  "rows":[[round(la+random.uniform(-3,3),3),round(lo+random.uniform(-3,3),3),round(random.choice([2,5,8,30,150])*random.uniform(0.5,1.5),1),random.choice([0,1,1,2]),(now-random.randint(0,86400000))//60000,1] for i in range(3000) for (la,lo) in [random.choice([(-10,25),(-15,-55),(38,-120),(-25,135),(60,100)])]]})
STATUS=json.dumps({"generatedAt":iso(now-3*60000),"feeds":{"flights":{"ok":True,"note":"4000 aircraft from OpenSky Network (worldwide, API client), 3100 with a known type, 410 KB","at":iso(now-3*60000),"count":4000},"gdacs":{"ok":True,"note":"2 events","at":iso(now-3*60000)},"launches":{"ok":True,"note":"upcoming + previous","at":iso(now-40*60000)},"tle":{"ok":True,"note":"stations, visual","at":iso(now-90*60000)},"news":{"ok":False,"note":"GDELT unreachable","failedAt":iso(now-3*60000),"at":iso(now-50*60000)},"fires":{"ok":True,"note":"3000 hotspots","at":iso(now-12*60000),"count":3000},"ships":{"ok":True,"note":"4001 vessels (18000 reports in 60 s), 300 KB","at":iso(now-2*60000),"count":4001}}})
RADAR=json.dumps({"version":"2.0","generated":now//1000,"host":"https://tilecache.rainviewer.com","radar":{"past":[{"time":now//1000-600*(12-i),"path":f"/v2/radar/{now//1000-600*(12-i)}"} for i in range(13)]}})
# v2.2: ships worldwide (the live-data job's AISStream snapshot)
_lanes=[(1.25,103.8),(51.0,1.5),(30.0,32.5),(35.9,-5.6),(22.3,114.2),(40.6,-74.0),(-33.9,18.4),(29.5,48.9),(34.0,-118.3),(60.1,24.9)]
SHIPS=json.dumps({"generatedAt":iso(now-2*60000),"src":"AISStream","fields":['mmsi','lat','lng','sog','cog','hdg','nav','t','name','type'],
  "rows":[[563000001,1.25,103.8,11.2,45,44,0,(now-60000)//60000,"MOCK STAR",70]]+[[200000000+i,round(la+random.uniform(-4,4),4),round(lo+random.uniform(-4,4),4),round(random.uniform(0,18),1),random.randint(0,359),None,random.choice([0,1,5]),(now-random.randint(0,1800000))//60000,f"VESSEL {i}",random.choice([70,80,60,30,37,None])] for i in range(4000) for (la,lo) in [random.choice(_lanes)]]})
SHIPS_STATIC=json.dumps({"generatedAt":iso(now-2*60000),"src":"AISStream","fields":['mmsi','name','type','call','imo','dest','draught','len','beam','t'],"rows":[[563000001,"MOCK STAR",70,"9V1234",9876543,"ROTTERDAM",12.5,300,48,(now-60000)//60000]]})
import zlib, struct
def _png(w,h,rgba):
    raw=b''.join(b'\x00'+bytes(rgba)*w for _ in range(h))
    ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
RADAR_TILE=_png(512,512,(60,140,255,120))
# v2.3: Terrarium terrain tiles (a slope rising 1 m per pixel to the east, from 100 m) and OpenStreetMap buildings
def _png_px(w,h,fn):
    raw=b''.join(b'\x00'+b''.join(bytes(fn(x,y)) for x in range(w)) for y in range(h))
    ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
def _terrarium(m): v=int(m+32768); return (v//256, v%256, 0, 255)
TERRAIN_TILE=_png_px(256,256,lambda x,y: _terrarium(100+x))
def buildings_json(lat,lng,n=60):
    import math
    els=[]; k=1/110540; kl=1/(111320*math.cos(math.radians(lat)))
    for i in range(n):
        cx=((i%10)-4.5)*40; cy=((i//10)-3)*40; w=12
        pts=[(cx-w,cy-w),(cx+w,cy-w),(cx+w,cy+w),(cx-w,cy+w),(cx-w,cy-w)]
        tags={"building":"yes"}
        if i==0: tags={"building":"office","height":"120","name":"Mock Tower"}
        elif i%3==0: tags={"building":"apartments","building:levels":"6"}
        els.append({"type":"way","id":1000+i,"tags":tags,"geometry":[{"lat":lat+y*k,"lon":lng+x*kl} for x,y in pts]})
    return json.dumps({"elements":els})
ADB_META=json.dumps({"generatedAt":iso(now-2*86400000),"source":"test","count":512345,"rows":600000})
# v2.4: the history branch (48 hourly frames; aircraft drift east one degree an hour) and a USGS catalogue window
_H0=(now//3600000-48)*3600000
def _hkey(t): return time.strftime('%Y%m%d%H', time.gmtime(t/1000))
def history_frame(i):
    r=random.Random(i); t=_H0+i*3600000
    fl=[[round((la+r.uniform(-2,2))*100),round(((lo+i)%360-180)*100),r.choice([0,50,150,350,370]),r.randint(0,359)] for _ in range(500+10*i) for (la,lo) in [r.choice([(50,-30+180),(40,100+180),(35,-100+180)])]]
    return {"t":t,"flights":{"fields":['lat100','lng100','fl','trk'],"rows":fl},"ships":{"fields":['lat100','lng100'],"rows":[[round(1.25*100+r.randint(-200,200)),round(103.8*100+r.randint(-200,200))] for _ in range(40)]},
            "alerts":[{"lat":21.4,"lng":130.2,"type":"TC","level":"Red" if i>30 else "Orange","name":"Tropical Cyclone NEOGURI-26","country":"Philippines"}],"fires":{"count":3000,"high":200},"src":{},**({"stale":True} if i==10 else {})}
HISTORY_INDEX=json.dumps({"generatedAt":iso(now),"days":14,"frames":[{"file":f"frames/{_hkey(_H0+i*3600000)}.json","t":_H0+i*3600000,"flights":500+10*i,"ships":40,"alerts":1,"fires":3000,"stale":i==10} for i in range(48)]})
HISTORY_FRAMES={f"frames/{_hkey(_H0+i*3600000)}.json":i for i in range(48)}
FDSN=json.dumps({"features":[{"id":f"h{i}","properties":{"mag":round(4+(i%30)/10,1),"place":f"Mock Trench {i}","time":_H0-86400000+i*1800000,"url":"https://earthquake.usgs.gov/earthquakes/eventpage/h%d"%i},"geometry":{"coordinates":[140+(i%10),35-(i%7),30]}} for i in range(140)]})
# v2.6: the regional-data branch (California pesticide use by section, USGS county estimates, EPA TRI facilities)
_rr=random.Random(26)
_PUR_CHEMS=[("573","1,3-DICHLOROPROPENE"),("1601","GLYPHOSATE, POTASSIUM SALT"),("136","SULFUR"),("385","CHLOROPICRIN")]
_PUR_ROWS=[[round(36.6+_rr.uniform(-1.2,1.2),4),round(-119.8+_rr.uniform(-0.8,0.8),4),0,0,_rr.randint(1,40),_rr.randint(0,3),0,_rr.randint(0,3),None,_rr.randint(0,1),"10",f"M{_rr.randint(10,20):02d}S{_rr.randint(15,25):02d}E{_rr.randint(1,36):02d}"] for _ in range(1500)]
for i,r in enumerate(_PUR_ROWS): r[2]=round(_rr.choice([20,300,3000,30000])*_rr.uniform(0.5,1.5),1); r[3]=round(r[2]*_rr.choice([0,0,0.5,1]),1); r[6]=round(r[2]*0.6,1)
_PUR_ROWS[0][:4]=[36.6,-119.8,123456.0,100000.0]
PUR_INDEX=json.dumps({"generatedAt":iso(now),"year":2023,"src":"CDPR PUR","records":3100000,"sectionsWithUse":len(_PUR_ROWS),"placed":3000000,"unplaced":12,"nonAgRecords":50000,"lbs":200000000,"aerialLbs":30000000,
  "chems":[{"code":c,"name":n,"lbs":(4-i)*1000000,"aer":(4-i)*100000,"apps":1000,"sections":500,"months":[(m+1)*1000 for m in range(12)],"file":f"chem/{c}.json" if i<3 else None} for i,(c,n) in enumerate(_PUR_CHEMS)],
  "sites":[{"code":"3001","name":"ALMOND"},{"code":"29143","name":"STRAWBERRY"}],"counties":{"10":"FRESNO"}})
PUR_SECTIONS=json.dumps({"year":2023,"fields":['lat','lng','lbs','aerialLbs','apps','chem1','chem1Lbs','chem2','chem3','site','county','plss'],"rows":_PUR_ROWS})
PUR_CHEM={f"chem/{c}.json":json.dumps({"code":c,"name":n,"fields":['lat','lng','lbs','aerialLbs','apps'],"rows":[[r[0],r[1],round(r[2]/(i+2),1),round(r[3]/(i+2),1),r[4]] for r in _PUR_ROWS[i::3]]}) for i,(c,n) in enumerate(_PUR_CHEMS[:3])}
_cty=[("19001","Adair County","IA",41.33,-94.47,569),("17113","McLean County","IL",40.49,-88.85,1183),("06019","Fresno County","CA",36.76,-119.66,5958)]+[(f"{20000+i}",f"County {i}","KS",37+_rr.uniform(-2,2),-98+_rr.uniform(-4,4),700) for i in range(300)]
USGS_INDEX=json.dumps({"generatedAt":iso(now),"year":2019,"compounds":[{"name":"GLYPHOSATE","kgHigh":120000000,"kgLow":110000000,"counties":3000,"file":"compound/glyphosate.json"},{"name":"ATRAZINE","kgHigh":30000000,"kgLow":28000000,"counties":2000,"file":"compound/atrazine.json"}]})
USGS_COUNTIES=json.dumps({"year":2019,"fields":['geoid','name','state','lat','lng','sqmi','kgHigh','top1','top1Kg','top2','top3'],"rows":[[g,n,st,la,lo,sq,250000,"GLYPHOSATE",150000,"ATRAZINE","2,4-D"] for g,n,st,la,lo,sq in _cty]})
USGS_COMP={f"compound/{k}.json":json.dumps({"name":k.upper(),"year":2019,"fields":['lat','lng','kgLow','kgHigh','geoid'],"rows":[[la,lo,int(f*0.9),f,g] for (g,n,st,la,lo,sq),f in zip(_cty,[150000,90000,40000]+[_rr.randint(10,200000) for _ in range(300)])]}) for k in ("glyphosate","atrazine")}
TRI=json.dumps({"generatedAt":iso(now),"year":2023,"fields":['lat','lng','lbs','carcinogenLbs','name','city','state','sector','trifid','top'],"rows":[[29.76,-95.36,2500000.0,40000.0,"MOCK REFINERY","HOUSTON","TX","Petroleum","77001MOCKR1",[["AMMONIA",900000.0],["BENZENE",40000.0]]]]+[[round(30+_rr.uniform(0,15),4),round(-120+_rr.uniform(0,45),4),round(_rr.choice([500,20000,300000]),1),0.0,f"PLANT {i}","TOWN","OH","Chemicals",f"X{i}",[["TOLUENE",100.0]]] for i in range(800)]})
# v2.7: CalEnviroScreen tracts and EPA ECHO facilities
_CES_IND=[("score","Overall CalEnviroScreen score"),("pesticides","Pesticide use nearby"),("pm25","Fine particles (PM2.5)"),("diesel","Diesel particulate matter"),("poverty","Poverty")]
_ces_rows=[["6019001000",36.72,-119.79,3000,"Fresno","93706","Fresno",[72.5,1200.5,14.1,0.3,60],[99.9,97.2,98,80,96]]]+[[f"60{_rr.randint(10000000,99999999)}",round(34+_rr.uniform(0,4),4),round(-121+_rr.uniform(0,4),4),4000,"County","90000",None,[_rr.uniform(10,70),_rr.choice([None,_rr.uniform(0,900)]),_rr.uniform(5,15),_rr.uniform(0,1),_rr.uniform(0,80)],[_rr.uniform(0,100),_rr.choice([None,_rr.uniform(0,100)]),_rr.uniform(0,100),_rr.uniform(0,100),_rr.uniform(0,100)]] for _ in range(600)]
CES=json.dumps({"generatedAt":iso(now),"version":"4.0","indicators":[{"key":k,"label":l} for k,l in _CES_IND],"fields":['tract','lat','lng','population','county','zip','place','values','percentiles'],"rows":_ces_rows})
ECHO=json.dumps({"generatedAt":iso(now),"total":1500000,"fields":['lat','lng','snc','qtrsNonCompliance','formalActions','penaltiesUsd','inspections','lastInspection','name','city','state','registryId','programs','status','programsInSnc'],
  "rows":[[36.7,-119.8,1,8,2,45000,12,"03/04/2025","BIG PLANT, LLC","FRESNO","CA","110000001","Clean Air Act, TRI","Significant Violation","CAA"]]+[[round(30+_rr.uniform(0,15),4),round(-120+_rr.uniform(0,45),4),_rr.choice([0,0,1]),_rr.randint(0,12),_rr.randint(0,3),_rr.choice([0,0,5000,250000]),3,"01/02/2024",f"FACILITY {i}","TOWN","OH",f"1100{i}","Clean Water Act","Violation Identified",None] for i in range(900)]})
# v2.8: Water Quality Portal pesticide sites
_WQ_CHEMS=[['Atrazine',3],['Simazine',4],['Metolachlor',None],['Glyphosate',700],['2,4-D',70],['Chlorpyrifos',None],['Imidacloprid',None],['Diuron',None],['Bifenthrin',None],['Metribuzin',None],['Acetochlor',None],['Diazinon',None],['Fipronil',None],['Carbaryl',None],['Alachlor',2]]
_WQ_ROWS=[[41.1781,-91.1821,'stream','Iowa River at Wapello, IA','USGS-05465500','USGS Iowa Water Science Center',30,12,2,1.4,[['Atrazine',4.2,8,20,'2025-06-03'],['Glyphosate',0.4,4,10,'2025-06-03']]],
 [36.7,-119.8,'well','Well 9 near Fresno','CAWB-9','California State Water Resources Control Board',4,2,1,0.5,[['Simazine',2.0,2,4,'2024-04-02']]],
 [36.75,-119.7,'well','Domestic well 12','CAWB-12','California State Water Resources Control Board',3,1,1,0,[['Imidacloprid',0.035,1,3,'2024-05-02']]],
 [36.8,-119.9,'stream','Fresno Slough','CAWB-30','California State Water Resources Control Board',6,0,0,0,[['Diuron',0,0,6,'2024-05-02']]],
 [43.13,-93.38,'lake','Clear Lake','IADNR-2','Iowa DNR, Water',2,0,0,0,[['Metolachlor',0,0,2,'2024-08-01']]]]
def _wq_sum(name,mcl):
    xs=[c for r in _WQ_ROWS for c in r[10] if c[0]==name]
    return {"name":name,"mcl":mcl,"sites":len(xs),"detectedAt":sum(1 for c in xs if c[2]),"samples":sum(c[3] for c in xs),"detections":sum(c[2] for c in xs)}
WQP=json.dumps({"generatedAt":iso(now),"years":3,"src":"Water Quality Portal","chems":[_wq_sum(n,m) for n,m in _WQ_CHEMS],"fields":['lat','lng','kind','name','siteId','organization','samples','detections','chemsDetected','maxRatioToLimit','chems'],"chemFields":['name','maxUgL','detections','samples','lastDate'],"rows":_WQ_ROWS})
REGIONAL={"wqp/sites.json":WQP,"ces/tracts.json":CES,"echo/facilities.json":ECHO,"pur/index.json":PUR_INDEX,"pur/sections.json":PUR_SECTIONS,**{"pur/"+k:v for k,v in PUR_CHEM.items()},"usgs/index.json":USGS_INDEX,"usgs/counties.json":USGS_COUNTIES,**{"usgs/"+k:v for k,v in USGS_COMP.items()},"tri/facilities.json":TRI}
# v2.13: weather grid for the wind and sky layers (data/weather.json is written at deploy time, so tests serve one):
# trade winds and westerlies, a typhoon east of the Philippines, thunderstorms over the Congo basin, the US Midwest and
# the Bay of Bengal, a rain band across the North Atlantic and snow over Siberia and Canada.
def weather_grid():
    import math
    S,LA0,LO0,NLA,NLO=6,-84,-180,29,60
    W={k:[] for k in ['u','v','t','cc','cl','ch','pr','wc']}
    def g(la,lo,cla,clo,r): d=((la-cla)**2+(((lo-clo+180)%360-180)*math.cos(math.radians(cla)))**2)/(r*r); return math.exp(-d)
    storms=[(21,130,6,18),(0,20,5,9),(38,-96,5,11),(15,88,5,10)]
    for i in range(NLA):
        for j in range(NLO):
            la,lo=LA0+i*S,LO0+j*S; a=abs(la)
            u=-6 if a<25 else (10 if a<60 else -3); v=1.5*math.sin(math.radians(lo*3))
            t=round(31*math.cos(math.radians(la))-8-(6 if la>0 else 0)*(a>45),1)
            cc=15+55*math.exp(-((la-5)/7)**2)+60*math.exp(-((a-52)/10)**2)+15*math.sin(math.radians(lo*2+la*3))
            pr=0.0; wc=3 if cc>60 else 1
            front=g(la,lo,40,-60,9)+g(la,lo,46,-45,9)+g(la,lo,52,-30,9)+g(la,lo,56,-15,8)
            if front>0.35: cc=max(cc,92); pr=max(pr,round(1+4*min(1,front),1)); wc=63
            for (sla,slo,r,p) in storms:
                k=g(la,lo,sla,slo,r)
                if k>0.25: cc=max(cc,95); pr=max(pr,round(p*k,1)); wc=95 if k>0.5 else max(wc,81)
                if (sla,slo)==(21,130) and k>0.05: u,v=u-12*(la-sla)/r,v+12*((lo-slo)/r)
            if g(la,lo,62,100,14)>0.4 or g(la,lo,58,-100,10)>0.4: cc=max(cc,85); pr=0.8; wc=73; t=-12.0
            W['u'].append(round(u,1)); W['v'].append(round(v,1)); W['t'].append(t); W['cc'].append(int(max(0,min(100,cc))))
            W['cl'].append(int(max(0,min(100,cc*0.7)))); W['ch'].append(int(max(0,min(100,cc*(0.9 if a>30 else 0.4)))))
            W['pr'].append(pr); W['wc'].append(wc)
    return json.dumps({"generatedAt":iso(now-40*60000),"source":"Open-Meteo (CC BY 4.0)","step":S,"lat0":LA0,"lon0":LO0,"nlat":NLA,"nlon":NLO,**W})
WEATHER=weather_grid()
def handler(route):
    u=route.request.url
    if 'elevation-tiles-prod/terrarium/' in u: return route.fulfill(status=200, body=TERRAIN_TILE, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'})
    if 'overpass-api.de/api/interpreter' in u and 'building' in __import__('urllib.parse').parse.unquote(u):
        import re as _re; m=_re.search(r'around:\d+,(-?[\d.]+),(-?[\d.]+)', __import__('urllib.parse').parse.unquote(u))
        return route.fulfill(status=200, body=buildings_json(float(m.group(1)), float(m.group(2))), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
    if u.startswith('http://localhost') and '/app/data/weather.json' in u and not os.environ.get('MOCK_NO_WEATHER'): return route.fulfill(status=200, body=WEATHER, headers={'Content-Type':'application/json'})
    if u.startswith('http://localhost'): return route.continue_()
    b=None; ct='application/json'
    if 'api.rainviewer.com' in u: return route.fulfill(status=200, body=RADAR, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'tilecache.rainviewer.com' in u: return route.fulfill(status=200, body=RADAR_TILE, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/regional-data/' in u:
        k=u.split('/regional-data/')[1].split('?')[0]
        if k in REGIONAL: return route.fulfill(status=200, body=REGIONAL[k], headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
        return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/open-data/' in u: return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})  # v2.9: test_v29 serves its own
    if 'raw.githubusercontent.com' in u and '/history/index.json' in u: return route.fulfill(status=200, body=HISTORY_INDEX, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/history/frames/' in u:
        k='frames/'+u.split('/history/frames/')[1].split('?')[0]
        if k in HISTORY_FRAMES: return route.fulfill(status=200, body=json.dumps(history_frame(HISTORY_FRAMES[k])), headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
        return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    if 'earthquake.usgs.gov/fdsnws/' in u: return route.fulfill(status=200, body=FDSN, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/live-data/fires.json' in u: return route.fulfill(status=200, body=FIRES, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/live-data/ships.json' in u: return route.fulfill(status=200, body=SHIPS, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/live-data/ships-static.json' in u: return route.fulfill(status=200, body=SHIPS_STATIC, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/live-data/status.json' in u: return route.fulfill(status=200, body=STATUS, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/aircraft-db/meta.json' in u: return route.fulfill(status=200, body=ADB_META, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'raw.githubusercontent.com' in u and '/aircraft-db/types/' in u:
        k=u.split('/types/')[1][:2]; return route.fulfill(status=200, body=json.dumps({f"{k}0001":["A388","TEST1","L4J"]}), headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
    if 'earthquake.usgs.gov' in u: b=quakes(300 if 'week' in u else 30, 7 if 'week' in u else 1)
    elif 'eonet' in u: b=EONET
    elif 'gdeltproject' in u: b=GDELT
    elif 'thespacedevs' in u: b=LL2
    elif 'gdacs' in u: b=GDACS
    elif USE_REAL and 'raw.githubusercontent.com' in u and '/live-data/' in u:
        name=u.split('/live-data/')[1].split('?')[0]; rb=real_snapshot(name)
        if rb is None: return route.fulfill(status=404, body='404', headers={'Access-Control-Allow-Origin':'*'})
        return route.fulfill(status=200, body=rb, headers={'Content-Type':'text/plain' if name.endswith('.txt') else 'application/json','Access-Control-Allow-Origin':'*'})
    elif USE_REAL and ('localhost' in u) and ('/app/data/cameras.json' in u or '/app/data/networks.json' in u or '/app/data/alpr/' in u):
        name=u.split('/app/data/')[1].split('?')[0]; p=os.path.join(REAL,name)
        if os.path.exists(p): return route.fulfill(status=200, body=open(p,'rb').read(), headers={'Content-Type':'application/json'})
        return route.fulfill(status=404, body='404')
    elif 'raw.githubusercontent.com' in u and 'live-data/flights.json' in u: b=SNAP
    elif 'raw.githubusercontent.com' in u and 'live-data' in u: return route.fulfill(status=404, body='404: Not Found', headers={'Access-Control-Allow-Origin':'*'})
    elif CORS_REAL and any(h in u for h in ['opensky-network','adsb.lol','airplanes.live','adsb.fi']): return route.abort('failed')
    elif USE_REAL and any(h in u for h in ['gdacs.org','celestrak.org']): return route.abort('failed')
    elif 'digitraffic.fi/api/ais/v1/locations' in u: b=AIS_LOC
    elif 'digitraffic.fi/api/ais/v1/vessels' in u: b=AIS_VES
    elif 'data.cityofchicago.org' in u: b=CHI
    elif 'opensky-network' in u: b=OSKY
    elif 'celestrak' in u: b=TLE; ct='text/plain'
    if b is None: return route.abort()
    route.fulfill(status=200, body=b, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']
