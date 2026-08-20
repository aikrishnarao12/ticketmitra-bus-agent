-- TicketMitra production schema (Postgres).
-- Run this once against a fresh database (see README "Database setup").

CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- A "trip" is a scheduled bus service an admin has configured: one operator,
-- one bus type, one route, one daily departure time, one fare. Replaces the
-- old randomly-generated catalog with real, admin-managed inventory.
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  operator TEXT NOT NULL,
  bus_type TEXT NOT NULL,
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  distance_km INTEGER NOT NULL CHECK (distance_km > 0),
  departure_time TEXT NOT NULL,      -- 'HH:MM'
  arrival_time TEXT NOT NULL,        -- 'HH:MM'
  arrives_next_day BOOLEAN NOT NULL DEFAULT FALSE,
  duration_hours NUMERIC(4,1) NOT NULL,
  fare_per_seat INTEGER NOT NULL CHECK (fare_per_seat > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_city <> to_city)
);
CREATE INDEX IF NOT EXISTS idx_trips_route ON trips (from_city, to_city) WHERE active;

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  pnr TEXT NOT NULL UNIQUE,
  trip_id INTEGER NOT NULL REFERENCES trips (id),
  travel_date DATE NOT NULL,
  contact_phone TEXT NOT NULL,
  total_fare INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (contact_phone);

CREATE TABLE IF NOT EXISTS booking_passengers (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  age INTEGER,
  gender TEXT
);

-- One row per booked seat on a given trip+date. The primary key is what
-- makes double-booking impossible even under concurrent requests: a second
-- attempt to insert the same (trip_id, travel_date, seat_number) fails.
CREATE TABLE IF NOT EXISTS seat_holds (
  trip_id INTEGER NOT NULL REFERENCES trips (id),
  travel_date DATE NOT NULL,
  seat_number INTEGER NOT NULL,
  booking_id INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, travel_date, seat_number)
);
