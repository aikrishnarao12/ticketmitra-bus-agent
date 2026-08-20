const { toolDefinitions, runTool, todayISO } = require("./tools");

// OpenRouter — an OpenAI-compatible gateway that can route to Claude models.
const API_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;

// Very small in-memory per-session conversation store.
// sessionId -> array of OpenAI-style message objects
const sessions = new Map();
const MAX_HISTORY_MESSAGES = 40;

function systemPrompt() {
  return `You are TicketMitra, an SMS-based advance bus ticket booking assistant for a mock/test Indian bus network (this is a TESTING app, not a real bus operator — payments are simulated).

Today's date is ${todayISO()} (YYYY-MM-DD). Resolve relative dates like "tomorrow" or "next Friday" against this date before calling any tool.

Rules:
- Never invent bus timings, fares, seat availability, PNRs or booking status — always get them from tools.
- You are texting with the user over SMS, so keep replies short, plain text, no markdown tables/headers/bullets, and no more than a few lines.
- Collect what you need step by step: origin city, destination city, travel date, then show bus options.
- Before calling book_seats, always restate the chosen bus, date, seat(s) and total fare and get an explicit "yes"/confirmation from the user.
- You need passenger name(s) and a contact phone number before booking.
- After a successful booking, always tell the user their PNR clearly.
- If a city name is unclear or not recognized, call list_cities and suggest the closest matches.
- If the user asks to cancel, you need both the PNR and the contact phone number used for that booking.
- Be friendly, concise, and efficient — this is a text conversation, not an essay.`;
}

async function callModel(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set on the server.");
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      // Optional but recommended by OpenRouter for attribution/analytics:
      "HTTP-Referer": process.env.APP_URL || "https://github.com/",
      "X-Title": "TicketMitra Bus Booking Demo",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt() }, ...messages],
      tools: toolDefinitions,
      tool_choice: "auto",
      max_tokens: 1024,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : JSON.stringify(data);
    throw new Error(`OpenRouter API error (${res.status}): ${msg}`);
  }
  return data;
}

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function trimHistory(history) {
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
}

async function handleMessage(sessionId, userText) {
  const history = getHistory(sessionId);
  history.push({ role: "user", content: userText });

  let finalText = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callModel(history);
    const message = response.choices[0].message;
    history.push(message);

    const toolCalls = message.tool_calls || [];
    finalText = (message.content || "").trim();

    if (toolCalls.length === 0) break;

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const output = runTool(call.function.name, args);
      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  trimHistory(history);
  return finalText || "(no response)";
}

function resetSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = { handleMessage, resetSession };
