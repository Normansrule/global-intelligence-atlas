import sys; sys.path.insert(0, sys.argv[-1]); from mock import handler, ARGS
from playwright.sync_api import sync_playwright
CHECK = """() => {
  const sel = ['.topbar','.rail','#layers','#notes','.statusbar','.stage .ticker','.stage .toast','.stage .timebar','.stage .mapctl','#view-pop','#ride','.topbar .search','.top-status','.statusbar .readout','#clock','.viewpick','#spin','#shot','.statusbar .quality','.statusbar .attribution','.stage .space-bar'];
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display==='none'||cs.visibility==='hidden'||el.hidden) return false; let p=el.parentElement; while(p){ const c=getComputedStyle(p); if (c.display==='none') return false; p=p.parentElement; } const r=el.getBoundingClientRect(); return r.width>2&&r.height>2; };
  const items = sel.map(s=>[s,document.querySelector(s)]).filter(([s,e])=>vis(e)).map(([s,e])=>[s,e,e.getBoundingClientRect()]);
  const out=[];
  for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++){
    const [sa,ea,a]=items[i],[sb,eb,b]=items[j];
    if (ea.contains(eb)||eb.contains(ea)) continue;
    const ix=Math.min(a.right,b.right)-Math.max(a.left,b.left), iy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if (ix>1&&iy>1) out.push(`${sa} × ${sb} (${Math.round(ix)}×${Math.round(iy)})`);
  }
  // anything poking outside the window
  for (const [s,e,r] of items) if (r.right>innerWidth+1||r.bottom>innerHeight+1||r.left<-1||r.top<-1) out.push(`${s} off-screen`);
  return out;
}"""
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    for (w,h) in [(1920,1080),(1440,900),(1280,720),(1100,700),(900,650),(390,844)]:
        pg=b.new_page(viewport={'width':w,'height':h}); pg.route('**/*', handler); pg.add_init_script("try{localStorage.setItem('global-intelligence-atlas-version','1.12')}catch(e){}")
        pg.goto('http://localhost:8765/app/#@30,-40,2.2&b=bluemarble&l=sun,borders,quakes,aircraft', wait_until='commit'); pg.wait_for_timeout(9000)
        res={}
        res['default']=pg.evaluate(CHECK)
        pg.evaluate("() => gia.select({layer:'quakes', d: gia.state.data.quakes[0]})"); pg.wait_for_timeout(500)
        res['details']=pg.evaluate(CHECK)
        pg.evaluate("() => { document.getElementById('timebar').hidden=false; }"); pg.wait_for_timeout(400)
        res['timebar']=pg.evaluate(CHECK)
        pg.evaluate("() => { const t=document.getElementById('toast'); t.textContent='Switched to Fast quality to keep things smooth (change it at the bottom right).'; t.hidden=false; }"); pg.wait_for_timeout(200)
        res['toast']=pg.evaluate(CHECK)
        pg.evaluate("() => document.getElementById('view-btn').click()"); pg.wait_for_timeout(300)
        res['mapsection']=pg.evaluate(CHECK)
        # v2.1: radar slider in Layers, Data health and the watch-area form
        pg.evaluate("() => { gia.toggleLayer('radar', true); document.querySelector('.rail [data-section=layers]').click(); }"); pg.wait_for_timeout(2500)
        res['radar']=pg.evaluate(CHECK)
        pg.evaluate("() => gia.health.show()"); pg.wait_for_timeout(1500)
        res['health']=pg.evaluate(CHECK)
        pg.evaluate("() => { gia.watch.open(); document.querySelector('[data-watch=new]').click(); }"); pg.wait_for_timeout(500)
        res['watch']=pg.evaluate(CHECK)
        pg.evaluate("() => document.querySelector('.rail [data-section=\"intel\"]').click()"); pg.wait_for_timeout(600)
        res['intel']=pg.evaluate(CHECK)
        pg.evaluate("() => document.querySelector('[data-intel-tab=\"tools\"]').click()"); pg.wait_for_timeout(300)
        pg.evaluate("() => document.querySelector('[data-intel-tool=\"redact\"]').click()"); pg.wait_for_timeout(300)
        res['inspector']=pg.evaluate(CHECK)
        # Space: flying to the Moon swaps the Live strip for the space bar and opens the Moon's card
        pg.evaluate("() => gia.cosmos.explore('moon', { instant: true })"); pg.wait_for_timeout(1500)
        res['space']=pg.evaluate(CHECK)
        print(w,h, {k:v for k,v in res.items() if v} or 'no overlaps')
        pg.close()
    b.close()
