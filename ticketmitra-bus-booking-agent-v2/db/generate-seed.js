// Regenerates db/seed.sql from data/cities.js + data/catalog.js.
// Those two files are ONLY used here now — they used to be the app's live
// (in-memory, regenerated-every-request) bus network before the app moved
// to a real Postgres database. Run this again if you want a fresh/bigger
// starter dataset; day-to-day route management should go through /admin
// instead.
//
// Usage: node db/generate-seed.js > db/seed.sql

const { CITIES } = require("../data/cities");
const { getBusesForRoute } = require("../data/catalog");

function esc(s) {
  return String(s).replace(/'/g, "''");
}

const rows = [];
for (const a of CITIES) {
  for (const b of CITIES) {
    if (a.code === b.code) continue;
    const { buses, error } = getBusesForRoute(a.name, b.name);
    if (error) continue;
    for (const bus of buses) {
      rows.push(
        `('${esc(bus.operator)}','${esc(bus.type)}',${bus.totalSeats},'${esc(bus.fromCity)}','${esc(
          bus.toCity
        )}',${bus.distanceKm},'${bus.departure}','${bus.arrival}',${bus.arrivesNextDay},${bus.durationHours},${bus.fare})`
      );
    }
  }
}

const sql = `-- Auto-generated seed data (from data/cities.js + data/catalog.js) --
-- Gives a fresh database a realistic starter set of trips across 10 cities.
-- Regenerate with: node db/generate-seed.js > db/seed.sql

INSERT INTO trips (operator, bus_type, total_seats, from_city, to_city, distance_km, departure_time, arrival_time, arrives_next_day, duration_hours, fare_per_seat) VALUES
${rows.join(",\n")};

INSERT INTO cities (name) VALUES
${CITIES.map((c) => `('${esc(c.name)}')`).join(",\n")}
ON CONFLICT (name) DO NOTHING;
`;

process.stdout.write(sql);
