// A stand-in for wss://stream.aisstream.io used by tests: checks the subscription, then sends AIS messages in
// the format AISStream uses, as binary frames. Usage: node tests/ais/mock-aisstream.mjs <port>  (needs the ws package)
import { WebSocketServer } from 'ws';
const port = Number(process.argv[2] ?? 8790);
export const msgs = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const mmsi = 230000000 + i; const lat = 59 + (i % 50) * 0.05; const lng = 18 + Math.floor(i / 50) * 0.05; const t = new Date(Date.now() - i * 1000).toISOString().replace('T', ' ').replace('Z', '123 +0000 UTC');
    out.push({ MessageType: 'PositionReport', MetaData: { MMSI: mmsi, ShipName: `TEST VESSEL ${i}@@@  `, latitude: lat, longitude: lng, time_utc: t },
      Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lng, Sog: i % 3 ? 12.3 : 0, Cog: 90.5, TrueHeading: i % 7 ? 88 : 511, NavigationalStatus: 0, Valid: true } } });
    if (i % 2 === 0) out.push({ MessageType: 'ShipStaticData', MetaData: { MMSI: mmsi, ShipName: `TEST VESSEL ${i}`, latitude: lat, longitude: lng, time_utc: t },
      Message: { ShipStaticData: { UserID: mmsi, Name: `TEST VESSEL ${i}@@@@`, Type: 70 + (i % 10), CallSign: `OJ${i}`, ImoNumber: 9000000 + i, Destination: 'HELSINKI@@', MaximumStaticDraught: 7.5, Dimension: { A: 100, B: 20, C: 10, D: 8 } } } });
  }
  out.push({ MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: { PositionReport: { UserID: 1, Latitude: 91, Longitude: 181 } } }); // "not available"
  return out;
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const wss = new WebSocketServer({ port, perMessageDeflate: true });
  wss.on('connection', (ws) => {
    const t = setTimeout(() => ws.close(), 3000);
    ws.on('message', (d) => {
      clearTimeout(t); const sub = JSON.parse(d.toString());
      if (!String(sub.APIKey).startsWith('test-key')) { ws.send(Buffer.from(JSON.stringify({ error: 'Api Key Is Not Valid' }))); return ws.close(); }
      if (!Array.isArray(sub.BoundingBoxes?.[0]?.[0])) { ws.send(Buffer.from(JSON.stringify({ error: 'bad bounding box' }))); return ws.close(); }
      for (const m of msgs(Number(process.env.N ?? 400))) ws.send(Buffer.from(JSON.stringify(m)), { binary: true });
    });
  });
  console.log(`mock AISStream on ws://localhost:${port}`);
}
