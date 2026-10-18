// SPDX-License-Identifier: AGPL-3.0-only
// Ships in view from AISStream (aisstream.io). AISStream does not allow connections straight from a web page, so the
// desktop app opens the stream here in Rust with the user's own free key, listens for a few seconds and hands the raw
// messages back to the page, which keeps the latest report of each vessel (site/app/js/ais.js).
// Only AISStream's own address is ever contacted.
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::{tungstenite::Message, Connector};

pub const AIS_URL: &str = "wss://stream.aisstream.io/v0/stream";
const MAX_MESSAGES: usize = 6000;

fn tls() -> Connector {
    let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("TLS versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    Connector::Rustls(Arc::new(config))
}

/// The subscription AISStream expects within three seconds. `boxes` is a list of [[south, west], [north, east]].
pub fn subscription(key: &str, boxes: &[[[f64; 2]; 2]]) -> Result<String, String> {
    if key.len() < 8 || key.len() > 128 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("that does not look like an AISStream key".into());
    }
    if boxes.is_empty() || boxes.len() > 4 {
        return Err("pass one to four boxes".into());
    }
    for b in boxes {
        let [[s, w], [n, e]] = *b;
        if !(-90.0..=90.0).contains(&s) || !(-90.0..=90.0).contains(&n) || !(-180.0..=180.0).contains(&w) || !(-180.0..=180.0).contains(&e) || s >= n || w >= e {
            return Err("box out of range".into());
        }
    }
    Ok(serde_json::json!({
        "APIKey": key,
        "BoundingBoxes": boxes,
        "FilterMessageTypes": ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"],
    })
    .to_string())
}

/// Listens for `seconds` (2–15) and returns every message as JSON text. `url` is AIS_URL except in tests.
pub async fn collect(url: &str, key: &str, boxes: &[[[f64; 2]; 2]], seconds: u64) -> Result<Vec<String>, String> {
    let sub = subscription(key, boxes)?;
    let connect = tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(tls()));
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(10), connect)
        .await
        .map_err(|_| "AISStream did not answer".to_string())?
        .map_err(|e| format!("AISStream connection failed: {e}"))?;
    ws.send(Message::text(sub)).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds.clamp(2, 15));
    loop {
        let next = tokio::time::timeout_at(deadline, ws.next()).await;
        let msg = match next {
            Err(_) | Ok(None) => break,
            Ok(Some(Err(e))) => { if out.is_empty() { return Err(format!("AISStream: {e}")); } break; }
            Ok(Some(Ok(m))) => m,
        };
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
            Message::Close(_) => break,
            _ => continue,
        };
        if out.is_empty() && text.starts_with("{\"error\"") {
            return Err(format!("AISStream: {text}"));
        }
        out.push(text);
        if out.len() >= MAX_MESSAGES { break; }
    }
    let _ = ws.close(None).await;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscription_checks() {
        let b = [[[58.0, 17.0], [62.0, 22.0]]];
        assert!(subscription("abcdef0123456789", &b).unwrap().contains("\"BoundingBoxes\":[[[58.0,17.0],[62.0,22.0]]]"));
        assert!(subscription("bad key with spaces", &b).is_err());
        assert!(subscription("abcdef0123456789", &[[[10.0, 0.0], [5.0, 1.0]]]).is_err(), "south must be below north");
        assert!(subscription("abcdef0123456789", &[]).is_err());
    }
}
