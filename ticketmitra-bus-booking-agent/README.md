# TicketMitra — SMS-style Bus Ticket Booking Agent (Test Demo)

An AI agent you can text (in this demo, via a web page styled like a texting
app) to book advance bus tickets. It runs on a **mock, made-up bus network**
across 10 Indian cities — no real bus operator, no real payments. It exists
to prove out the "text a bot, get a booked seat" flow before ever connecting
to a real ticketing system (see "Going live for real" below).

## How it works

- `data/cities.js` / `data/catalog.js` — a fake but realistic bus network:
  10 cities, several buses per route, seat maps, fares.
- `lib/store.js` — in-memory "database" of seat holds and bookings (resets
  when the server restarts — swap for a real database before this is
  anything but a prototype).
- `lib/tools.js` — the actions the AI is allowed to take: search buses, view
  a seat map, book seats, look up a booking, cancel a booking.
- `lib/agent.js` — sends the conversation to Claude (via OpenRouter) and lets
  it call those actions to actually get things done, rather than just talk
  about them.
- `server.js` + `public/index.html` — a small web server and a chat page
  that looks like a texting thread.

No external npm packages are required — it only uses Node.js's built-in
`http`, `crypto`, and `fetch`, which keeps setup and deployment simple.

## 1. Get an API key (OpenRouter)

This agent is powered by Claude, accessed through **OpenRouter** (a gateway
that gives you one API key for many AI models, including Claude).

1. Go to **openrouter.ai** and sign in / create an account.
2. Click **Keys** in the dashboard, then **Create Key**. Copy it — it starts
   with `sk-or-v1-`.
3. Under **Credits**, add a small amount of prepaid balance (a few dollars
   goes a very long way for testing).

## 2. Configure your key

Copy `.env.example` to a new file named `.env`, and paste your key in:

```
OPENROUTER_API_KEY=sk-or-v1-your-real-key-here
```

`.env` is already excluded from git (see `.gitignore`) so it will never be
uploaded to GitHub by accident.

## 3. Run it locally (optional)

If you have Node.js installed on your computer:

```
npm start
```

Then open `http://localhost:3000` in your browser and start texting the bot,
e.g. *"Book me a ticket from Hyderabad to Bangalore next Friday"*.

You don't have to run it locally, though — see the deployment guide for
running it on the web with no coding at all.

## Example conversation

```
You:  I need a bus from Hyderabad to Bengaluru on 25 Aug
Bot:  Found a bus: Jabbar Travels (AC Sleeper), departs 05:30, ₹1250/seat.
      Shall I book seat 5? Send me your name and phone to confirm.
You:  Yes, Krishna Rao, 9876543210
Bot:  Booked! Your PNR is TM77DEC3. Total fare ₹1250. Safe travels!
```

## Testing it thoroughly

Try things like:
- Ambiguous city names ("blore", "hyd") — the agent should ask or guess sensibly.
- A past date — it should refuse (advance booking only).
- Booking more seats than exist on a bus.
- Cancelling with the wrong phone number (should be refused) and the right one (should work).
- Asking "what's my booking status" with a PNR.

## Going live for real

Real bus operators (state transport corporations, aggregators, etc.) do not
generally offer a public API for booking seats. To move beyond this demo:

1. Contact the operator(s) you want to support and ask about an official
   **agent/partner API** — this is a business relationship, not something
   you can build around without permission.
2. Automating bookings against a site that hasn't authorized it usually
   breaks that site's terms of service and can trigger fraud protections on
   payments — avoid that route entirely.
3. Once you have a real API, swap `data/catalog.js` and `lib/store.js` for
   calls to that API, and add real payment handling. The chat/agent layer
   (`lib/agent.js`, `lib/tools.js`) barely needs to change.

## Project structure

```
bus-booking-agent/
├── data/
│   ├── cities.js       # the 10 mock cities + distances
│   └── catalog.js       # generates the mock bus schedule/fares
├── lib/
│   ├── store.js          # in-memory bookings & seat holds
│   ├── tools.js           # actions the AI agent can call
│   ├── agent.js            # talks to Claude via OpenRouter, runs the tool loop
│   └── dotenv-lite.js       # tiny .env file loader (no npm dependency)
├── public/
│   └── index.html            # the SMS-style chat web page
├── test/
│   └── mock-openrouter-server.js  # lets you test the flow without an API key
├── server.js
├── package.json
├── .env.example
└── .gitignore
```
