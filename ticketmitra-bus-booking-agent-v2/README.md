# TicketMitra — SMS-style Bus Ticket Booking Agent

An AI agent you can text (in this demo, via a web page styled like a texting
app) to book advance bus tickets. **v2** moves it from an in-memory toy to a
real, persistent backend: a Postgres database of routes/buses/bookings, and
a password-protected admin panel to manage them. It is still a **mock bus
network** you control (not a real bus operator) — no real bus is running
these routes yet, so there's no real payment processing either. See "Going
live for real" below for what that next step actually involves.

## How it works

- `db/schema.sql` — the database structure: `cities`, `trips` (a trip is one
  scheduled bus service — operator, route, time, fare, seat count),
  `bookings`, `booking_passengers`, `seat_holds` (this table's primary key
  is what makes double-booking impossible, even under concurrent requests).
- `db/seed.sql` — a realistic starter set of ~450 trips across 10 Indian
  cities, so the app isn't empty on day one. Regenerate with `npm run seed`.
- `lib/db.js` — all database access, using the standard `pg` (node-postgres)
  package.
- `lib/tools.js` — the actions the AI is allowed to take: search buses, view
  a seat map, book seats, look up/cancel a booking. Talks to `lib/db.js`.
- `lib/agent.js` — sends the conversation to Claude (via OpenRouter) and
  lets it call those actions to actually get things done.
- `server.js` + `public/index.html` — the chat web server and page.
- `views/admin.html` — the admin panel (add/deactivate trips, view/cancel
  bookings), served at `/admin` behind a password.

## 1. Get an AI API key (OpenRouter)

1. Go to **openrouter.ai**, sign in, click **Keys** → **Create Key**. Copy
   it (starts with `sk-or-v1-`).
2. Under **Credits**, add a small prepaid balance (a few dollars covers a
   lot of testing).

## 2. Get a free database (Neon)

1. Go to **neon.com**, sign up (no credit card required).
2. Create a project. On the project dashboard, copy the **connection
   string** — it looks like
   `postgres://user:password@host.neon.tech/dbname?sslmode=require`.
3. Load the schema and starter data into it. With `psql` installed
   locally:
   ```
   psql "your-connection-string" -f db/schema.sql
   psql "your-connection-string" -f db/seed.sql
   ```
   If you don't have `psql`, Neon's own web dashboard has a **SQL Editor**
   where you can paste the contents of `db/schema.sql`, run it, then paste
   `db/seed.sql` and run that too.

## 3. Configure your `.env`

Copy `.env.example` to `.env` and fill in:

```
OPENROUTER_API_KEY=sk-or-v1-...
DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
ADMIN_PASSWORD=pick-something-strong
```

`.env` is already excluded from git (see `.gitignore`).

## 4. Run it locally (optional)

```
npm install
npm start
```

Open `http://localhost:3000` to chat, or `http://localhost:3000/admin`
(login with any username + your `ADMIN_PASSWORD`) to manage routes and
bookings.

## Deploying (e.g. Render)

Same as before: connect the GitHub repo, build command `npm install`,
start command `npm start`, and set the environment variables above
(`OPENROUTER_API_KEY`, `DATABASE_URL`, `ADMIN_PASSWORD`) in the host's
dashboard — never in code.

## The admin panel

`/admin` is protected by HTTP Basic Auth against `ADMIN_PASSWORD` — your
browser will prompt for a username (anything) and password. From there you
can:
- Add a new trip (operator, bus type, route, timing, fare).
- Deactivate/reactivate a trip (deactivated trips stop showing up in
  search, but past bookings on them are untouched).
- View recent bookings and cancel any of them (admin cancellation doesn't
  require the customer's phone number, unlike the AI agent's own
  `cancel_booking` tool, which does).

If `ADMIN_PASSWORD` isn't set, `/admin` is disabled entirely rather than
left open.

## Example conversation

```
You:  I need a bus from Hyderabad to Bengaluru on 25 Aug
Bot:  Found a bus: Jabbar Travels (AC Sleeper), departs 05:30, ₹1250/seat.
      Shall I book seat 5? Send me your name and phone to confirm.
You:  Yes, Krishna Rao, 9876543210
Bot:  Booked! Your PNR is TM77DEC3. Total fare ₹1250. Safe travels!
```

## Testing it thoroughly

- Ambiguous city names ("blore", "hyd").
- A past date (should be refused — advance booking only).
- Booking more seats than exist, or the same seat twice at once (the
  database itself rejects the double-booking, not just app logic).
- Cancelling with the wrong phone number (refused) vs. the right one, vs.
  cancelling from `/admin` (no phone needed).
- Add a trip in `/admin`, then immediately ask the bot to search for it.

## Going live for real

Real bus operators (state transport corporations, aggregators, etc.) do not
generally offer a public API for booking seats. To move beyond this app
being your own mock network:

1. Contact the operator(s) you want to support and ask about an official
   **agent/partner API** — this is a business relationship, not something
   to build around without permission.
2. Automating bookings against a site that hasn't authorized it usually
   breaks that site's terms of service and can trigger fraud protections on
   payments — avoid that route entirely.
3. Only take real customer money once there's a real bus a customer can
   actually board. Until then, keep this as a working prototype/demo.
4. Once you do have a real inventory source, `lib/db.js` is the one place
   that changes — swap its queries for calls to the real operator's API.
   The chat/agent layer (`lib/agent.js`, `lib/tools.js`) barely needs to
   change, and `/admin` becomes internal tooling for whichever trips you
   manage directly.

## Project structure

```
bus-booking-agent/
├── db/
│   ├── schema.sql          # table definitions
│   ├── seed.sql             # starter data (~450 trips, 10 cities)
│   └── generate-seed.js      # regenerates seed.sql
├── data/
│   ├── cities.js              # only used by generate-seed.js now
│   └── catalog.js              # only used by generate-seed.js now
├── lib/
│   ├── db.js                    # all Postgres access (pg package)
│   ├── tools.js                   # actions the AI agent can call
│   ├── agent.js                    # talks to Claude via OpenRouter, runs the tool loop
│   └── dotenv-lite.js               # tiny .env file loader (no npm dependency)
├── public/
│   └── index.html                    # the SMS-style chat web page
├── views/
│   └── admin.html                     # the admin panel (behind ADMIN_PASSWORD)
├── test/
│   └── mock-openrouter-server.js       # lets you test the flow without an API key
├── server.js
├── package.json
├── .env.example
└── .gitignore
```
