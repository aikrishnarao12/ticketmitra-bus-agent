// A tiny fake OpenRouter-compatible server used ONLY for local testing of the
// agent's tool-calling loop, when real internet access to openrouter.ai isn't
// available (e.g. inside a restricted sandbox). It scripts a realistic
// multi-turn conversation: greet -> search_buses -> book_seats -> confirm.
//
// Run with:  node test/mock-openrouter-server.js
// Then point the app at it with: OPENROUTER_API_URL=http://localhost:4001/api/v1/chat/completions

const http = require("http");

let step = 0;

function toolCallMessage(name, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_" + step,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function textMessage(text) {
  return { role: "assistant", content: text, tool_calls: [] };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body);
    const messages = payload.messages;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastToolResult = [...messages].reverse().find((m) => m.role === "tool");

    step++;
    let message;

    if (step === 1) {
      // First user message -> ask a search_buses tool call
      message = toolCallMessage("search_buses", {
        from: "Hyderabad",
        to: "Bengaluru",
        date: "2026-08-25",
      });
    } else if (lastToolResult && step === 2) {
      // Got bus list -> summarize in plain text, asking user to confirm
      const data = JSON.parse(lastToolResult.content);
      const bus = data.buses[0];
      message = textMessage(
        `Found a bus: ${bus.operator} (${bus.type}) departs ${bus.departure}, fare Rs${bus.farePerSeat}. Shall I book seat 5 for you? Reply with your name and phone to confirm.`
      );
    } else if (step === 3) {
      // User confirmed with name/phone -> call book_seats
      message = toolCallMessage("book_seats", {
        busId: 1,
        date: "2026-08-25",
        seatNumbers: [5],
        passengers: [{ name: "Test Passenger", age: 28, gender: "M" }],
        contactPhone: "9999999999",
      });
    } else if (lastToolResult && step === 4) {
      const data = JSON.parse(lastToolResult.content);
      message = textMessage(
        `Booked! Your PNR is ${data.booking.pnr}. Total fare Rs${data.booking.totalFare}. Safe travels!`
      );
    } else {
      message = textMessage("(mock server ran out of script)");
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});

const PORT = 4001;
server.listen(PORT, () => console.log(`Mock OpenRouter server on http://localhost:${PORT}`));
