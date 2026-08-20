// Postgres-backed data layer. Requires the `pg` npm package (listed in
// package.json — installs automatically wherever this is deployed) and a
// DATABASE_URL environment variable.
//
// Design note: booking and cancellation are each done as a SINGLE SQL
// statement built from chained CTEs (WITH ... AS (...)). Postgres runs a
// whole statement atomically, so this gets us transaction safety (no
// double-booked seats, no half-completed cancellations) without needing to
// manage BEGIN/COMMIT/ROLLBACK by hand.

const { Pool } = require("pg");
const crypto = require("crypto");

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function q(text, params) {
  const res = await getPool().query(text, params);
  return res.rows;
}

function generatePnr() {
  return "TM" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// ---------------- Cities ----------------

async function listCities() {
  const rows = await q("SELECT name FROM cities ORDER BY name");
  return rows.map((r) => r.name);
}

async function resolveCity(nameQuery) {
  const cities = await listCities();
  const query = String(nameQuery || "").trim().toLowerCase();
  return (
    cities.find((c) => c.toLowerCase() === query) ||
    cities.find((c) => c.toLowerCase().startsWith(query)) ||
    cities.find((c) => c.toLowerCase().includes(query)) ||
    null
  );
}

// ---------------- Search ----------------

async function searchTrips(fromQuery, toQuery, date) {
  const from = await resolveCity(fromQuery);
  const to = await resolveCity(toQuery);
  if (!from) return { error: `Unknown origin city "${fromQuery}".` };
  if (!to) return { error: `Unknown destination city "${toQuery}".` };
  if (from === to) return { error: "Origin and destination must be different cities." };

  const rows = await q(
    `SELECT t.id AS "tripId", t.operator, t.bus_type AS "busType", t.total_seats AS "totalSeats",
            t.from_city AS "fromCity", t.to_city AS "toCity", t.distance_km AS "distanceKm",
            t.departure_time AS "departure", t.arrival_time AS "arrival",
            t.arrives_next_day AS "arrivesNextDay", t.duration_hours AS "durationHours",
            t.fare_per_seat AS "farePerSeat",
            t.total_seats - COALESCE(
              (SELECT count(*) FROM seat_holds sh WHERE sh.trip_id = t.id AND sh.travel_date = $3), 0
            ) AS "seatsAvailable"
     FROM trips t
     WHERE t.active AND t.from_city = $1 AND t.to_city = $2
     ORDER BY t.departure_time`,
    [from, to, date]
  );

  if (rows.length === 0) return { error: `No trips currently scheduled from ${from} to ${to}.` };
  return { from, to, date, distanceKm: rows[0].distanceKm, trips: rows };
}

async function getSeatMap(tripId, date) {
  const trips = await q(
    `SELECT id, bus_type AS "busType", total_seats AS "totalSeats", fare_per_seat AS "farePerSeat"
     FROM trips WHERE id = $1 AND active`,
    [tripId]
  );
  const trip = trips[0];
  if (!trip) return { error: `Unknown or inactive tripId ${tripId}.` };

  const held = await q("SELECT seat_number FROM seat_holds WHERE trip_id = $1 AND travel_date = $2", [tripId, date]);
  const bookedSet = new Set(held.map((r) => r.seat_number));

  const seats = [];
  for (let n = 1; n <= trip.totalSeats; n++) {
    seats.push({ number: n, status: bookedSet.has(n) ? "booked" : "available" });
  }
  return { tripId, date, type: trip.busType, farePerSeat: trip.farePerSeat, seats };
}

// ---------------- Booking ----------------

async function bookSeats({ tripId, date, seatNumbers, passengers, contactPhone }) {
  const trips = await q(`SELECT id, total_seats AS "totalSeats", fare_per_seat AS "farePerSeat" FROM trips WHERE id = $1 AND active`, [
    tripId,
  ]);
  const trip = trips[0];
  if (!trip) return { error: `Unknown or inactive tripId ${tripId}.` };
  if (seatNumbers.some((s) => s < 1 || s > trip.totalSeats)) {
    return { error: `Invalid seat number for this bus (valid range 1-${trip.totalSeats}).` };
  }

  const pnr = generatePnr();
  const totalFare = trip.farePerSeat * seatNumbers.length;
  const names = passengers.map((p) => p.name);
  const ages = passengers.map((p) => p.age ?? null);
  const genders = passengers.map((p) => p.gender ?? null);

  let rows;
  try {
    rows = await q(
      `WITH new_booking AS (
         INSERT INTO bookings (pnr, trip_id, travel_date, contact_phone, total_fare)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id
       ),
       seat_rows AS (
         SELECT ord, seat FROM unnest($6::int[]) WITH ORDINALITY AS t(seat, ord)
       ),
       pax_rows AS (
         SELECT ord, name, age, gender
         FROM unnest($7::text[], $8::int[], $9::text[]) WITH ORDINALITY AS t(name, age, gender, ord)
       ),
       ins_seats AS (
         INSERT INTO seat_holds (trip_id, travel_date, seat_number, booking_id)
         SELECT $2, $3, sr.seat, (SELECT id FROM new_booking) FROM seat_rows sr
       ),
       ins_pax AS (
         INSERT INTO booking_passengers (booking_id, seat_number, name, age, gender)
         SELECT (SELECT id FROM new_booking), sr.seat, pr.name, pr.age, pr.gender
         FROM seat_rows sr JOIN pax_rows pr ON sr.ord = pr.ord
       )
       SELECT (SELECT id FROM new_booking) AS "bookingId"`,
      [pnr, tripId, date, contactPhone, totalFare, seatNumbers, names, ages, genders]
    );
  } catch (err) {
    if (/duplicate key.*seat_holds/i.test(err.message)) {
      return { error: "One of those seats was just taken by someone else. Please pick different seat(s)." };
    }
    throw err;
  }
  if (!rows[0]) return { error: "Booking failed for an unknown reason." };

  return { booking: await getBookingByPnr(pnr) };
}

async function getBookingByPnr(pnr) {
  const rows = await q(
    `SELECT b.pnr, b.status, b.created_at AS "createdAt", b.travel_date AS date,
            b.contact_phone AS "contactPhone", b.total_fare AS "totalFare",
            t.operator, t.bus_type AS "busType", t.from_city AS "fromCity", t.to_city AS "toCity",
            t.departure_time AS departure, t.arrival_time AS arrival,
            (SELECT json_agg(json_build_object('seatNumber', seat_number, 'name', name, 'age', age, 'gender', gender) ORDER BY seat_number)
               FROM booking_passengers WHERE booking_id = b.id) AS passengers
     FROM bookings b JOIN trips t ON t.id = b.trip_id
     WHERE b.pnr = $1`,
    [String(pnr).toUpperCase()]
  );
  return rows[0] || null;
}

async function listBookingsByPhone(phone) {
  const rows = await q(
    `SELECT b.pnr, b.status, b.travel_date AS date, b.total_fare AS "totalFare",
            t.operator, t.from_city AS "fromCity", t.to_city AS "toCity", t.departure_time AS departure
     FROM bookings b JOIN trips t ON t.id = b.trip_id
     WHERE b.contact_phone = $1
     ORDER BY b.created_at DESC`,
    [phone]
  );
  return rows;
}

async function cancelBooking(pnr, contactPhone) {
  const existing = await q(`SELECT id, contact_phone AS "contactPhone", status FROM bookings WHERE pnr = $1`, [
    String(pnr).toUpperCase(),
  ]);
  const booking = existing[0];
  if (!booking) return { error: `No booking found with PNR ${pnr}.` };
  if (contactPhone && booking.contactPhone !== contactPhone) {
    return { error: "The phone number does not match this booking. Cancellation denied." };
  }
  if (booking.status === "CANCELLED") return { error: `Booking ${pnr} is already cancelled.` };

  await q(
    `WITH upd AS (
       UPDATE bookings SET status = 'CANCELLED' WHERE id = $1 RETURNING id
     )
     DELETE FROM seat_holds WHERE booking_id = (SELECT id FROM upd)`,
    [booking.id]
  );
  return { booking: await getBookingByPnr(pnr) };
}

// ---------------- Admin: trips ----------------

async function adminListTrips() {
  return q(
    `SELECT id, operator, bus_type AS "busType", total_seats AS "totalSeats", from_city AS "fromCity",
            to_city AS "toCity", distance_km AS "distanceKm", departure_time AS "departure",
            arrival_time AS "arrival", arrives_next_day AS "arrivesNextDay", duration_hours AS "durationHours",
            fare_per_seat AS "farePerSeat", active
     FROM trips ORDER BY from_city, to_city, departure_time`
  );
}

async function adminCreateTrip(trip) {
  const rows = await q(
    `INSERT INTO trips (operator, bus_type, total_seats, from_city, to_city, distance_km,
                         departure_time, arrival_time, arrives_next_day, duration_hours, fare_per_seat)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      trip.operator,
      trip.busType,
      trip.totalSeats,
      trip.fromCity,
      trip.toCity,
      trip.distanceKm,
      trip.departure,
      trip.arrival,
      !!trip.arrivesNextDay,
      trip.durationHours,
      trip.farePerSeat,
    ]
  );
  return rows[0];
}

async function adminSetTripActive(id, active) {
  const rows = await q(`UPDATE trips SET active = $2 WHERE id = $1 RETURNING id`, [id, active]);
  return rows[0] || null;
}

async function adminListBookings(limit = 100) {
  return q(
    `SELECT b.pnr, b.status, b.travel_date AS date, b.contact_phone AS "contactPhone",
            b.total_fare AS "totalFare", b.created_at AS "createdAt",
            t.operator, t.from_city AS "fromCity", t.to_city AS "toCity", t.departure_time AS departure
     FROM bookings b JOIN trips t ON t.id = b.trip_id
     ORDER BY b.created_at DESC LIMIT $1`,
    [limit]
  );
}

module.exports = {
  listCities,
  resolveCity,
  searchTrips,
  getSeatMap,
  bookSeats,
  getBookingByPnr,
  listBookingsByPhone,
  cancelBooking,
  adminListTrips,
  adminCreateTrip,
  adminSetTripActive,
  adminListBookings,
};
