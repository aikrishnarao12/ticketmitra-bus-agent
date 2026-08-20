// Deterministically generates a mock bus schedule for any city pair.
// Same route + direction always returns the same buses (stable busIds),
// so seat availability can be tracked across requests without a database.

const { findCity, distanceBetween } = require("./cities");

const OPERATORS = [
  "Sri Vari Travels", "Orange Tours & Travels", "VRL Travels", "Kaveri Travels",
  "SRS Travels", "Parveen Travels", "Konduskar Travels", "Greenline Travels",
  "Jabbar Travels", "National Travels",
];

const BUS_TYPES = [
  { key: "seater_nonac", label: "Non-AC Seater (2+3)", seats: 45, ratePerKm: 1.1, kmph: 45 },
  { key: "seater_ac", label: "AC Seater (2+2)", seats: 40, ratePerKm: 1.6, kmph: 50 },
  { key: "volvo", label: "Volvo Multi-Axle AC Seater/Sleeper (2+2)", seats: 36, ratePerKm: 2.0, kmph: 55 },
  { key: "sleeper_ac", label: "AC Sleeper (2+1)", seats: 30, ratePerKm: 2.2, kmph: 48 },
];

const DEPARTURE_SLOTS = [
  "05:30", "06:45", "08:00", "13:00", "15:30", "19:00", "20:30", "21:45", "22:30", "23:00",
];

// tiny deterministic PRNG (mulberry32) seeded from a string
function seedFromString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addMinutesToTime(hhmm, minutesToAdd) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m + minutesToAdd;
  const dayOffset = Math.floor(total / (24 * 60));
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return { time: `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`, dayOffset };
}

/**
 * Returns the mock bus list for a route. Buses are stable per (fromCode,toCode).
 */
function getBusesForRoute(fromQuery, toQuery) {
  const from = findCity(fromQuery);
  const to = findCity(toQuery);
  if (!from) return { error: `Unknown origin city "${fromQuery}".` };
  if (!to) return { error: `Unknown destination city "${toQuery}".` };
  if (from.code === to.code) return { error: "Origin and destination must be different cities." };

  const distance = distanceBetween(from.code, to.code);
  if (!distance) return { error: `No route data between ${from.name} and ${to.name}.` };

  const rand = mulberry32(seedFromString(`${from.code}-${to.code}`));
  const busCount = 4 + Math.floor(rand() * 3); // 4-6 buses

  const buses = [];
  const usedSlots = new Set();
  for (let i = 0; i < busCount; i++) {
    let slotIdx;
    do {
      slotIdx = Math.floor(rand() * DEPARTURE_SLOTS.length);
    } while (usedSlots.has(slotIdx) && usedSlots.size < DEPARTURE_SLOTS.length);
    usedSlots.add(slotIdx);
    const departure = DEPARTURE_SLOTS[slotIdx];

    const type = BUS_TYPES[Math.floor(rand() * BUS_TYPES.length)];
    const operator = OPERATORS[Math.floor(rand() * OPERATORS.length)];

    const durationHours = Math.round((distance / type.kmph) * 10) / 10;
    const arrival = addMinutesToTime(departure, Math.round(durationHours * 60));
    const fare = Math.round((distance * type.ratePerKm) / 10) * 10;

    buses.push({
      busId: `${from.code}-${to.code}-${i + 1}`,
      operator,
      type: type.label,
      typeKey: type.key,
      totalSeats: type.seats,
      fromCode: from.code,
      fromCity: from.name,
      toCode: to.code,
      toCity: to.name,
      distanceKm: distance,
      departure,
      arrival: arrival.time,
      arrivesNextDay: arrival.dayOffset > 0,
      durationHours,
      fare,
    });
  }

  buses.sort((a, b) => a.departure.localeCompare(b.departure));
  return { from, to, distance, buses };
}

function getBusById(busId) {
  const [fromCode, toCode] = busId.split("-").slice(0, 2);
  const { buses } = getBusesForRoute(fromCode, toCode);
  return (buses || []).find((b) => b.busId === busId) || null;
}

module.exports = { getBusesForRoute, getBusById, BUS_TYPES };
