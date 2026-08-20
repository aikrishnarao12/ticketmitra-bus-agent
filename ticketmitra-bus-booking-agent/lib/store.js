// In-memory data store for seat holds and bookings.
// NOTE: resets whenever the server restarts — fine for a demo/test app,
// swap for a real database before this is anything but a prototype.

const crypto = require("crypto");

const bookedSeatsByBusDate = new Map(); // "busId|date" -> Set(seatNumbers)
const bookingsByPnr = new Map(); // pnr -> booking object
const pnrsByPhone = new Map(); // phone -> [pnr,...]

function keyFor(busId, date) {
  return `${busId}|${date}`;
}

function getBookedSeats(busId, date) {
  return bookedSeatsByBusDate.get(keyFor(busId, date)) || new Set();
}

function seatsAvailableCount(busId, date, totalSeats) {
  return totalSeats - getBookedSeats(busId, date).size;
}

function generatePnr() {
  return "TM" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function createBooking({ bus, date, seatNumbers, passengers, contactPhone }) {
  const key = keyFor(bus.busId, date);
  const booked = bookedSeatsByBusDate.get(key) || new Set();

  const conflict = seatNumbers.find((s) => booked.has(s));
  if (conflict) {
    return { error: `Seat ${conflict} was just taken by someone else. Please pick another seat.` };
  }
  if (seatNumbers.some((s) => s < 1 || s > bus.totalSeats)) {
    return { error: `Invalid seat number for this bus (valid range 1-${bus.totalSeats}).` };
  }

  seatNumbers.forEach((s) => booked.add(s));
  bookedSeatsByBusDate.set(key, booked);

  const pnr = generatePnr();
  const totalFare = bus.fare * seatNumbers.length;
  const booking = {
    pnr,
    status: "CONFIRMED",
    createdAt: new Date().toISOString(),
    date,
    busId: bus.busId,
    operator: bus.operator,
    busType: bus.type,
    fromCity: bus.fromCity,
    toCity: bus.toCity,
    departure: bus.departure,
    arrival: bus.arrival,
    seatNumbers,
    passengers,
    contactPhone,
    totalFare,
  };
  bookingsByPnr.set(pnr, booking);

  const list = pnrsByPhone.get(contactPhone) || [];
  list.push(pnr);
  pnrsByPhone.set(contactPhone, list);

  return { booking };
}

function getBookingByPnr(pnr) {
  return bookingsByPnr.get(String(pnr).toUpperCase()) || null;
}

function getBookingsByPhone(phone) {
  const pnrs = pnrsByPhone.get(phone) || [];
  return pnrs.map((p) => bookingsByPnr.get(p)).filter(Boolean);
}

function cancelBooking(pnr, contactPhone) {
  const booking = getBookingByPnr(pnr);
  if (!booking) return { error: `No booking found with PNR ${pnr}.` };
  if (contactPhone && booking.contactPhone !== contactPhone) {
    return { error: "The phone number does not match this booking. Cancellation denied." };
  }
  if (booking.status === "CANCELLED") {
    return { error: `Booking ${pnr} is already cancelled.` };
  }
  booking.status = "CANCELLED";
  const key = keyFor(booking.busId, booking.date);
  const booked = bookedSeatsByBusDate.get(key);
  if (booked) booking.seatNumbers.forEach((s) => booked.delete(s));
  return { booking };
}

module.exports = {
  getBookedSeats,
  seatsAvailableCount,
  createBooking,
  getBookingByPnr,
  getBookingsByPhone,
  cancelBooking,
};
