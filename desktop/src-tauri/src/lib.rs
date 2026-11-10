// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas desktop shell. The window loads the same static site that GitHub Pages serves
// (../../site) and opens on the 3D globe. Links to other sites open in the default browser.
//
// `fetch_text` lets the page read live feeds natively. Browsers refuse cross-site responses that lack
// CORS headers, which covers most flight trackers. A request made here in Rust isn't subject to that,
// so the desktop app gets real-time flights while the website falls back to a 10-minute snapshot.
// Only https:// requests to the data hosts listed below are allowed, on the standard port, and every redirect
// must land on a listed host too. The page can't use this command to reach arbitrary sites or your local network,
// and an answer larger than MAX_BODY is refused rather than filling memory.
mod ais;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const ALLOWED_HOSTS: &[&str] = &[
    // flights
    "opensky-network.org", "api.airplanes.live", "api.adsb.lol", "opendata.adsb.fi", "api.adsbdb.com",
    // snapshots and space
    "raw.githubusercontent.com", "ll.thespacedevs.com", "celestrak.org",
    // Earth and hazards
    "earthquake.usgs.gov", "eonet.gsfc.nasa.gov", "www.gdacs.org", "services.swpc.noaa.gov", "api.open-meteo.com",
    "air-quality-api.open-meteo.com", "api.weather.gov",
    "firms.modaps.eosdis.nasa.gov", "api.rainviewer.com",
    // news, places, reference
    "api.gdeltproject.org", "en.wikipedia.org", "www.wikidata.org", "restcountries.com", "api.worldbank.org", "nominatim.openstreetmap.org",
    "overpass-api.de", "api.panoramax.xyz",
    // ships, cameras, crime
    "meri.digitraffic.fi", "api.tfl.gov.uk", "data.gov.hk", "cwwp2.dot.ca.gov", "data.police.uk",
    "data.cityofchicago.org", "data.cityofnewyork.us", "data.lacity.org", "data.sfgov.org",
    // Intelligence toolkit (osint.js): public registries only
    "dns.google", "rdap.org", "crt.sh", "stat.ripe.net", "cveawg.mitre.org", "api.first.org",
    "blockstream.info", "eth.blockscout.com",
];

struct Cache(Mutex<HashMap<String, (Instant, String)>>);
struct Http(reqwest::Client);

/// Largest answer the page may ask for (the biggest real feed, the worldwide flight snapshot, is about 6 MB).
const MAX_BODY: usize = 48 * 1024 * 1024;
/// How many redirects a data host may send before the request is dropped.
const MAX_REDIRECTS: usize = 5;

fn allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().map_or(true, |p| p == 443)
        && url.host_str().map_or(false, |h| ALLOWED_HOSTS.iter().any(|a| h == *a || h.ends_with(&format!(".{a}"))))
}

/// Every hop of a redirect must also be on the list, so an allowed host can't bounce a request to your router,
/// a local service or any other site.
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else if allowed(attempt.url()) {
            attempt.follow()
        } else {
            attempt.error("redirected to a host that is not on the desktop app's data-host list")
        }
    })
}

#[tauri::command]
async fn fetch_text(
    url: String,
    timeout_ms: Option<u64>,
    http: tauri::State<'_, Http>,
    cache: tauri::State<'_, Cache>,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("bad URL: {e}"))?;
    if !allowed(&parsed) {
        return Err(format!("{} is not on the desktop app's data-host list", parsed.host_str().unwrap_or("?")));
    }
    // Several layers can ask for the same URL within a moment of each other; answer those from memory.
    if let Some((t, body)) = cache.0.lock().unwrap().get(&url) {
        if t.elapsed() < Duration::from_secs(5) {
            return Ok(body.clone());
        }
    }
    let res = http
        .0
        .get(parsed)
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(20_000).clamp(1_000, 90_000)))
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "timed out".to_string() } else { e.to_string() })?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    if res.content_length().map_or(false, |n| n > MAX_BODY as u64) {
        return Err("answer too large".into());
    }
    let mut res = res;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err("answer too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    let mut c = cache.0.lock().unwrap();
    if c.len() > 256 {
        c.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(5));
    }
    if body.len() < 8 * 1024 * 1024 {
        c.insert(url, (Instant::now(), body.clone()));
    }
    Ok(body)
}

/// Ships in view: listens to AISStream with the user's own key (kept in the page's local storage) and returns the
/// raw messages. See src/ais.rs.
#[tauri::command]
async fn ais_collect(key: String, boxes: Vec<[[f64; 2]; 2]>, seconds: Option<u64>) -> Result<Vec<String>, String> {
    ais::collect(ais::AIS_URL, &key, &boxes, seconds.unwrap_or(6)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .user_agent(concat!("GlobalIntelligenceAtlas-Desktop/", env!("CARGO_PKG_VERSION"), " (+https://github.com/Normansrule/global-intelligence-atlas)"))
        .gzip(true)
        .connect_timeout(Duration::from_secs(10))
        .pool_idle_timeout(Duration::from_secs(90))
        .redirect(redirect_policy())
        .https_only(true)
        .build()
        .expect("HTTP client");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Http(client))
        .manage(Cache(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![fetch_text, ais_collect])
        .run(tauri::generate_context!())
        .expect("error while running Global Intelligence Atlas");
}

#[cfg(test)]
mod tests {
    use super::allowed;
    fn ok(u: &str) -> bool { allowed(&reqwest::Url::parse(u).unwrap()) }
    #[test]
    fn allowlist() {
        assert!(ok("https://opensky-network.org/api/states/all"));
        assert!(ok("https://raw.githubusercontent.com/Normansrule/global-intelligence-atlas/live-data/flights.json"));
        assert!(ok("https://dns.google/resolve?name=example.com&type=A"));
        assert!(ok("https://stat.ripe.net/data/as-overview/data.json?resource=AS13335"));
        assert!(!ok("https://notcrt.sh/"), "look-alike hosts are refused");
        assert!(!ok("http://opensky-network.org/api/states/all"), "plain http is refused");
        assert!(!ok("https://evil-opensky-network.org/"), "look-alike hosts are refused");
        assert!(!ok("https://opensky-network.org.evil.com/"), "suffix tricks are refused");
        assert!(!ok("https://127.0.0.1/"), "local network is refused");
        assert!(!ok("https://localhost:8080/"));
        assert!(!ok("https://opensky-network.org:8443/"), "only the standard https port");
        assert!(!ok("https://user:pass@opensky-network.org/"), "no credentials in the address");
        assert!(!ok("https://[::1]/"), "local network is refused");
    }
}
