
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = "https://bulk-api-efty.vercel.app/api/send";
const DEVELOPER = "https://t.me/Efty67";

// Temporary session and cooldown storage.
// For production, use persistent Redis/KV storage.
const sessions = new Map();
const cooldowns = new Map();

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  return response.json();
}

async function sendMessage(chatId, text, keyboard) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard
  });
}

const mainMenu = {
  inline_keyboard: [
    [{ text: "📩 Send Message", callback_data: "send" }],
    [{ text: "👨‍💻 Developer Contact", url: DEVELOPER }]
  ]
};

async function start(chatId) {
  sessions.delete(chatId);

  await sendMessage(
    chatId,
    "👋 <b>Welcome to Team EX Secret Message Sender!</b>\n\n" +
    "Your SMS marketing assistant.\n\n" +
    "✨ Simple • Fast • Easy\n\n" +
    "❤️ Developed by <b>EFTY</b>\n\n" +
    "Choose an option below:",
    mainMenu
  );
}

async function handleText(chatId, userId, text) {
  const session = sessions.get(userId);

  if (!session) {
    return sendMessage(
      chatId,
      "Please press /start to begin.",
      mainMenu
    );
  }

  if (session.step === "name") {
    if (text.length < 2 || text.length > 60) {
      return sendMessage(chatId, "Please enter a valid name.");
    }

    session.name = text;
    session.step = "number";

    return sendMessage(chatId, "📱 Enter the recipient's phone number:");
  }

  if (session.step === "number") {
    const number = text.replace(/[\s-]/g, "");

    // Accept Bangladesh mobile numbers only.
    if (!/^(?:\+8801|8801|01)[3-9]\d{8}$/.test(number)) {
      return sendMessage(
        chatId,
        "❌ Invalid Bangladesh mobile number. Please try again."
      );
    }

    session.number = number;
    session.step = "business";

    return sendMessage(chatId, "🏢 Enter your Business Name:");
  }

  if (session.step === "business") {
    if (text.length < 2 || text.length > 80) {
      return sendMessage(chatId, "Please enter a valid business name.");
    }

    session.business_name = text;
    session.step = "consent";

    return sendMessage(
      chatId,
      "📋 <b>Confirm your request</b>\n\n" +
      `Name: ${escapeHTML(session.name)}\n` +
      `Number: ${escapeHTML(session.number)}\n` +
      `Business: ${escapeHTML(session.business_name)}\n\n` +
      "⚠️ Confirm only if the recipient has explicitly agreed " +
      "to receive this marketing message.",
      {
        inline_keyboard: [
          [{ text: "✅ Recipient Has Consented", callback_data: "confirm" }],
          [{ text: "❌ Cancel", callback_data: "cancel" }]
        ]
      }
    );
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const action = query.data;

  await telegram("answerCallbackQuery", {
    callback_query_id: query.id
  });

  if (action === "send") {
    const remaining = (cooldowns.get(userId) || 0) - Date.now();

    if (remaining > 0) {
      return sendMessage(
        chatId,
        `⏳ Please wait ${Math.ceil(remaining / 1000)} seconds.`
      );
    }

    sessions.set(userId, { step: "name" });

    return sendMessage(chatId, "👤 Enter your name:");
  }

  if (action === "cancel") {
    sessions.delete(userId);
    return sendMessage(chatId, "❌ Request cancelled.", mainMenu);
  }

  if (action === "confirm") {
    const session = sessions.get(userId);

    if (!session || session.step !== "consent") {
      return sendMessage(chatId, "Session expired. Please start again.", mainMenu);
    }

    const remaining = (cooldowns.get(userId) || 0) - Date.now();

    if (remaining > 0) {
      return sendMessage(
        chatId,
        `⏳ Please wait ${Math.ceil(remaining / 1000)} seconds.`
      );
    }

    // Set cooldown before making the API request.
    cooldowns.set(userId, Date.now() + 60000);

    await sendMessage(
      chatId,
      "⏳ Your request is being processed. Please wait 1 minute."
    );

    try {
      const params = new URLSearchParams({
        name: session.name,
        number: session.number,
        business_name: session.business_name
      });

      const response = await fetch(`${API_URL}?${params.toString()}`, {
        method: "GET",
        signal: AbortSignal.timeout(15000)
      });

      const result = await response.text();

      if (!response.ok) {
        throw new Error("API request failed");
      }

      sessions.delete(userId);

      return sendMessage(
        chatId,
        "✅ <b>Request submitted!</b>\n\n" +
        "Your API request was accepted.\n" +
        "Please wait for the service response.\n\n" +
        "❤️ Developed by EFTY",
        mainMenu
      );

    } catch (error) {
      sessions.delete(userId);

      return sendMessage(
        chatId,
        "⚠️ API request could not be completed.\n" +
        "Please try again later.",
        mainMenu
      );
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!BOT_TOKEN) {
    return res.status(500).send("Bot configuration missing");
  }

  const secret = process.env.WEBHOOK_SECRET;

  if (
    secret &&
    req.headers["x-telegram-bot-api-secret-token"] !== secret
  ) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const update = req.body;

    if (update.message) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = (update.message.text || "").trim();

      if (text === "/start") {
        await start(chatId);
      } else {
        await handleText(chatId, userId, text);
      }
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return res.status(200).send("OK");

  } catch (error) {
    return res.status(200).send("OK");
  }
}
