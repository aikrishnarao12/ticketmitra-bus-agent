const db = require("./db");

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
// All handlers are async now (they hit the real database). busId in the
// AI-facing contract maps to the DB's internal tripId — kept as "busId"
// here so the system prompt / conversation behaviour doesn't need to change.
const handlers = {
  list_cities: async () => ({ cities: await db.listCities() }),

  search_buses: async ({ from, to, date }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    if (date < todayISO()) return { error: "date is in the past. This is an advance booking system only." };

    const result = await db.searchTrips(from, to, date);
    if (result.error) return result;

    return {
      from: result.from,
      to: result.to,
      date,
      distanceKm: result.distanceKm,
      buses: result.trips.map((t) => ({
        busId: t.tripId,
        operator: t.operator,
        type: t.busType,
        departure: t.departure,
        arrival: t.arrival,
        arrivesNextDay: t.arrivesNextDay,
        durationHours: t.durationHours,
        farePerSeat: t.farePerSeat,
        totalSeats: t.totalSeats,
        seatsAvailable: t.seatsAvailable,
      })),
    };
  },

  get_seat_map: async ({ busId, date }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    const result = await db.getSeatMap(Number(busId), date);
    if (result.error) return result;
    return { busId, date, type: result.type, farePerSeat: result.farePerSeat, seats: result.seats };
  },

  book_seats: async ({ busId, date, seatNumbers, passengers, contactPhone }) => {
    if (!isValidDate(date)) return { error: "date must be in YYYY-MM-DD format." };
    if (date < todayISO()) return { error: "date is in the past." };
    if (!Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      return { error: "seatNumbers must be a non-empty array." };
    }
    if (!Array.isArray(passengers) || passengers.length !== seatNumbers.length) {
      return { error: "passengers array must have exactly one entry per seat number." };
    }
    if (!contactPhone || String(contactPhone).replace(/\D/g, "").length < 10) {
      return { error: "A valid contact phone number (at least 10 digits) is required." };
    }
    const result = await db.bookSeats({ tripId: Number(busId), date, seatNumbers, passengers, contactPhone });
    if (result.error) return result;
    return {
      confirmation: "Booking confirmed. (Mock payment auto-approved for this test app.)",
      booking: result.booking,
    };
  },

  get_booking: async ({ pnr }) => {
    const booking = await db.getBookingByPnr(pnr);
    if (!booking) return { error: `No booking found with PNR ${pnr}.` };
    return { booking };
  },

  list_bookings_by_phone: async ({ phone }) => ({ bookings: await db.listBookingsByPhone(phone) }),

  cancel_booking: async ({ pnr, contactPhone }) => {
    return db.cancelBooking(pnr, contactPhone);
  },
};

async function runTool(name, input) {
  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool "${name}".` };
  try {
    return await handler(input || {});
  } catch (err) {
    return { error: `Tool "${name}" failed: ${err.message}` };
  }
}

module.exports = { toolDefinitions, runTool, todayISO };
