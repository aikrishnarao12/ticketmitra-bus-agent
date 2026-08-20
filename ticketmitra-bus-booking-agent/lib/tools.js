const { CITIES } = require("../data/cities");
const { getBusesForRoute, getBusById } = require("../data/catalog");
const store = require("./store");

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(dateStr));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Tool definitions (OpenAI-style "function calling" format, used by OpenRouter) ----
function tool(name, description, parameters) {
  return { type: "function", function: { name, description, parameters } };
}

const toolDefinitions = [
  tool(
    "list_cities",
    "List every city this mock bus network serves. Use this if the user names a city you're not sure is covered, or to suggest alternatives.",
    { type: "object", properties: {}, required: [] }
  ),
  tool(
    "search_buses",
    "Search available buses between two cities on a given date (advance reservation supported for any future date). Returns each bus's id, operator, type, timings, fare and live seat availability.",
    {
      type: "object",
      properties: {
        from: { type: "string", description: "Origin city name" },
        to: { type: "string", description: "Destination city name" },
        date: { type: "string", description: "Travel date, format YYYY-MM-DD" },
      },
      required: ["from", "to", "date"],
    }
  ),
  tool(
    "get_seat_map",
    "Get the full seat layout (available/booked) for a specific bus on a specific date.",
    {
      type: "object",
      properties: {
        busId: { type: "string", description: "Bus id returned by search_buses" },
        date: { type: "string", description: "Travel date, format YYYY-MM-DD" },
      },
      required: ["busId", "date"],
    }
  ),
  tool(
    "book_seats",
    "Book one or more seats on a bus for named passengers and process (mock) payment. Only call this after the user has confirmed the bus, seats and total fare.",
    {
      type: "object",
      properties: {
        busId: { type: "string" },
        date: { type: "string", description: "Travel date, format YYYY-MM-DD" },
        seatNumbers: {
          type: "array",
          items: { type: "integer" },
          description: "Seat numbers to book, one per passenger",
        },
        passengers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
              gender: { type: "string" },
            },
            required: ["name"],
          },
        },
        contactPhone: { type: "string", description: "Passenger contact phone number" },
      },
      required: ["busId", "date", "seatNumbers", "passengers", "contactPhone"],
    }
  ),
  tool("get_booking", "Look up an existing booking by its PNR code.", {
    type: "object",
    properties: { pnr: { type: "string" } },
    required: ["pnr"],
  }),
  tool("list_bookings_by_phone", "List all bookings made with a given contact phone number.", {
    type: "object",
    properties: { phone: { type: "string" } },
    required: ["phone"],
  }),
  tool(
    "cancel_booking",
    "Cancel an existing booking by PNR. The contact phone must match for verification.",
    {
      type: "object",
      properties: {
        pnr: { type: "string" },
        contactPhone: { type: "string" },
      },
      required: ["pnr", "contactPhone"],
    }
  ),
];

// ---- Handlers ----
const handlers = {
  list_cities: () => ({ cities: CITIES.map((c) => c.name) }),

  search_buses: ({ from, to, date }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    if (date < todayISO()) return { error: "date is in the past. This is an advance booking system only." };

    const result = getBusesForRoute(from, to);
    if (result.error) return result;

    const buses = result.buses.map((b) => ({
      busId: b.busId,
      operator: b.operator,
      type: b.type,
      departure: b.departure,
      arrival: b.arrival,
      arrivesNextDay: b.arrivesNextDay,
      durationHours: b.durationHours,
      farePerSeat: b.fare,
      totalSeats: b.totalSeats,
      seatsAvailable: store.seatsAvailableCount(b.busId, date, b.totalSeats),
    }));

    return {
      from: result.from.name,
      to: result.to.name,
      date,
      distanceKm: result.distance,
      buses,
    };
  },

  get_seat_map: ({ busId, date }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    const bus = getBusById(busId);
    if (!bus) return { error: `Unknown busId "${busId}".` };
    const booked = store.getBookedSeats(busId, date);
    const seats = [];
    for (let n = 1; n <= bus.totalSeats; n++) {
      seats.push({ number: n, status: booked.has(n) ? "booked" : "available" });
    }
    return { busId, date, type: bus.type, farePerSeat: bus.fare, seats };
  },

  book_seats: ({ busId, date, seatNumbers, passengers, contactPhone }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    if (date < todayISO()) return { error: "date is in the past." };
    const bus = getBusById(busId);
    if (!bus) return { error: `Unknown busId "${busId}".` };
    if (!Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      return { error: "seatNumbers must be a non-empty array." };
    }
    if (!Array.isArray(passengers) || passengers.length !== seatNumbers.length) {
      return { error: "passengers array must have exactly one entry per seat number." };
    }
    if (!contactPhone || String(contactPhone).replace(/\D/g, "").length < 10) {
      return { error: "A valid contact phone number (at least 10 digits) is required." };
    }
    const result = store.createBooking({ bus, date, seatNumbers, passengers, contactPhone });
    if (result.error) return result;
    return {
      confirmation: "Booking confirmed. (Mock payment auto-approved for this test app.)",
      booking: result.booking,
    };
  },

  get_booking: ({ pnr }) => {
    const booking = store.getBookingByPnr(pnr);
    if (!booking) return { error: `No booking found with PNR ${pnr}.` };
    return { booking };
  },

  list_bookings_by_phone: ({ phone }) => ({ bookings: store.getBookingsByPhone(phone) }),

  cancel_booking: ({ pnr, contactPhone }) => {
    const result = store.cancelBooking(pnr, contactPhone);
    return result;
  },
};

function runTool(name, input) {
  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool "${name}".` };
  try {
    return handler(input || {});
  } catch (err) {
    return { error: `Tool "${name}" failed: ${err.message}` };
  }
}

module.exports = { toolDefinitions, runTool, todayISO };
