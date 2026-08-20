require("./lib/dotenv-lite").load(); // loads .env without needing an npm dependency

const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleMessage, resetSession } = require("./lib/agent");
const db = require("./lib/db");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ---- Admin auth (HTTP Basic) ----
// Disabled entirely unless ADMIN_PASSWORD is set, so the panel isn't
// accidentally left open if someone forgets to configure it.
function isAdminAuthed(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx === -1 ? decoded : decoded.slice(idx + 1);
  return password === process.env.ADMIN_PASSWORD;
}

function requireAdmin(req, res) {
  if (!process.env.ADMIN_PASSWORD) {
    sendJson(res, 503, { error: "Admin panel is not configured. Set ADMIN_PASSWORD to enable it." });
    return false;
  }
  if (!isAdminAuthed(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="TicketMitra Admin"', "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Authentication required." }));
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://internal");
  const pathname = url.pathname;

  try {
    // ---- Chat ----
    if (req.method === "POST" && pathname === "/api/chat") {
      const { sessionId, message } = JSON.parse((await readBody(req)) || "{}");
      if (!sessionId || !message) return sendJson(res, 400, { error: "sessionId and message are required." });
      const reply = await handleMessage(sessionId, message);
      return sendJson(res, 200, { reply });
    }

    if (req.method === "POST" && pathname === "/api/reset") {
      const { sessionId } = JSON.parse((await readBody(req)) || "{}");
      resetSession(sessionId);
      return sendJson(res, 200, { ok: true });
    }

    // ---- Admin page ----
    if (req.method === "GET" && pathname === "/admin") {
      if (!requireAdmin(req, res)) return;
      const html = fs.readFileSync(path.join(VIEWS_DIR, "admin.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ---- Admin API: trips ----
    if (pathname === "/api/admin/trips") {
      if (!requireAdmin(req, res)) return;
      if (req.method === "GET") return sendJson(res, 200, { trips: await db.adminListTrips() });
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const required = ["operator", "busType", "totalSeats", "fromCity", "toCity", "distanceKm", "departure", "arrival", "durationHours", "farePerSeat"];
        const missing = required.filter((k) => body[k] === undefined || body[k] === "");
        if (missing.length) return sendJson(res, 400, { error: `Missing fields: ${missing.join(", ")}` });
        const created = await db.adminCreateTrip(body);
        return sendJson(res, 200, { id: created.id });
      }
    }

    const toggleMatch = pathname.match(/^\/api\/admin\/trips\/(\d+)\/toggle$/);
    if (toggleMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const { active } = JSON.parse((await readBody(req)) || "{}");
      const result = await db.adminSetTripActive(Number(toggleMatch[1]), !!active);
      if (!result) return sendJson(res, 404, { error: "Trip not found." });
      return sendJson(res, 200, { ok: true });
    }

    // ---- Admin API: bookings ----
    if (pathname === "/api/admin/bookings" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { bookings: await db.adminListBookings(200) });
    }

    const cancelMatch = pathname.match(/^\/api\/admin\/bookings\/([A-Za-z0-9]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const result = await db.cancelBooking(cancelMatch[1]); // no contactPhone = admin override
      return sendJson(res, result.error ? 400 : 200, result);
    }

    // ---- Static site (chat UI) ----
    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    res.writeHead(404); res.end("Not found");
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`TicketMitra server running: http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("WARNING: OPENROUTER_API_KEY is not set. Chat requests will fail until you set it (see .env.example).");
  }
  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL is not set. Booking requests will fail until you set it (see .env.example).");
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("NOTE: ADMIN_PASSWORD is not set, so /admin is disabled.");
  }
});
