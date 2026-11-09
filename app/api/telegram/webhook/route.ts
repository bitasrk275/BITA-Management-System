import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/field/service";
import {
  answerTelegramExecutiveQuery,
  getTelegramConfig,
  getTelegramLinksState,
  redeemTelegramLinkCode,
  sendTelegramMessage,
} from "@/lib/modules/telegram/service";

export const runtime = "nodejs";

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
    };
    chat?: {
      id?: number | string;
      type?: string;
    };
    text?: string;
  };
}

function sanitizeTelegramSecret(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256);
}

export async function POST(req: Request) {
  try {
    const expectedSecret = sanitizeTelegramSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
    if (expectedSecret) {
      const provided = sanitizeTelegramSecret(
        req.headers.get("x-telegram-bot-api-secret-token") ?? undefined,
      );
      if (provided !== expectedSecret) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    const update = (await req.json()) as TelegramUpdate;
    const msg = update.message;
    const chatId = msg?.chat?.id !== undefined ? String(msg.chat.id) : "";
    const text = msg?.text?.trim() ?? "";

    if (!chatId || !text) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const supabase = getSupabaseAdmin();
    const [config, links] = await Promise.all([
      getTelegramConfig(supabase),
      getTelegramLinksState(supabase),
    ]);

    if (!config.bot_token) {
      return NextResponse.json({ ok: true, configured: false });
    }

    const existingChat = links.chats.find((c) => c.chat_id === chatId && c.active);

    // Handle /start <6-digit-code>
    const startMatch = /^\/start(?:\s+(\d{6}))?$/i.exec(text);
    if (startMatch) {
      const code = startMatch[1];
      if (code) {
        const redeemed = await redeemTelegramLinkCode(
          supabase,
          code,
          chatId,
          msg?.from?.username ?? msg?.from?.first_name ?? null,
        );

        if (redeemed.ok) {
          const [welcome, statusMsg] = await Promise.all([
            answerTelegramExecutiveQuery(supabase, "/help"),
            answerTelegramExecutiveQuery(supabase, "/status"),
          ]);
          await sendTelegramMessage(
            config.bot_token,
            chatId,
            `✅ *Connected to BITA Executive Bot as ${redeemed.personName}!*\n\n${statusMsg}\n\n${welcome}`,
          );
          return NextResponse.json({ ok: true, paired: true });
        }

        if (existingChat) {
          const [welcome, statusMsg] = await Promise.all([
            answerTelegramExecutiveQuery(supabase, "/help"),
            answerTelegramExecutiveQuery(supabase, "/status"),
          ]);
          await sendTelegramMessage(
            config.bot_token,
            chatId,
            `✅ *Already connected to BITA Executive Bot as ${existingChat.person_name}!*\n\n${statusMsg}\n\n${welcome}`,
          );
          return NextResponse.json({ ok: true, paired: true, alreadyLinked: true });
        }

        await sendTelegramMessage(
          config.bot_token,
          chatId,
          `❌ *Pairing Failed:* ${redeemed.error}`,
        );
        return NextResponse.json({ ok: true, paired: false });
      }

      if (existingChat) {
        const [welcome, statusMsg] = await Promise.all([
          answerTelegramExecutiveQuery(supabase, "/help"),
          answerTelegramExecutiveQuery(supabase, "/status"),
        ]);
        await sendTelegramMessage(
          config.bot_token,
          chatId,
          `✅ *Connected to BITA Executive Bot as ${existingChat.person_name}!*\n\n${statusMsg}\n\n${welcome}`,
        );
        return NextResponse.json({ ok: true, paired: true, alreadyLinked: true });
      }
    }

    const isLinked = Boolean(existingChat);
    if (!isLinked) {
      await sendTelegramMessage(
        config.bot_token,
        chatId,
        "🔒 *BITA Executive Bot — Authorization Required*\n\nTo connect your Telegram account:\n1. Open **BITA Settings** (`/settings`) on the web dashboard.\n2. Click **Generate Telegram Link Code**.\n3. Send `/start <6-digit-code>` here.",
      );
      return NextResponse.json({ ok: true, authorized: false });
    }

    const reply = await answerTelegramExecutiveQuery(supabase, text);
    await sendTelegramMessage(config.bot_token, chatId, reply);

    return NextResponse.json({ ok: true, replied: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Telegram webhook failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hasBotTokenEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hasWebhookSecretEnv = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());

  if (url.searchParams.get("register") === "1") {
    try {
      const supabase = getSupabaseAdmin();
      const config = await getTelegramConfig(supabase);
      if (!config.bot_token) {
        return NextResponse.json(
          { ok: false, error: "No TELEGRAM_BOT_TOKEN configured." },
          { status: 400 },
        );
      }
      const webhookUrl = `${url.origin}/api/telegram/webhook`;
      const secretToken = sanitizeTelegramSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
      const body: Record<string, string> = { url: webhookUrl };
      if (secretToken) body.secret_token = secretToken;

      const [whRes, meRes] = await Promise.all([
        fetch(`https://api.telegram.org/bot${config.bot_token}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        fetch(`https://api.telegram.org/bot${config.bot_token}/getMe`),
      ]);
      const whData = (await whRes.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
      };
      const meData = (await meRes.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
      };
      return NextResponse.json({
        ok: Boolean(whData.ok),
        webhookUrl,
        description: whData.description ?? null,
        botUsername: meData.result?.username ?? null,
        botName: meData.result?.first_name ?? null,
        hasBotTokenEnv,
        hasWebhookSecretEnv,
      });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to register webhook" },
        { status: 500 },
      );
    }
  }

  if (url.searchParams.get("send_welcome") === "1") {
    try {
      const supabase = getSupabaseAdmin();
      const [config, links, statusMsg, helpMsg] = await Promise.all([
        getTelegramConfig(supabase),
        getTelegramLinksState(supabase),
        answerTelegramExecutiveQuery(supabase, "/status"),
        answerTelegramExecutiveQuery(supabase, "/help"),
      ]);
      if (!config.bot_token) {
        return NextResponse.json({ ok: false, error: "No bot token" }, { status: 400 });
      }
      const activeChats = links.chats.filter((c) => c.active);
      let sent = 0;
      for (const chat of activeChats) {
        const res = await sendTelegramMessage(
          config.bot_token,
          chat.chat_id,
          `✅ *Connected to BITA Executive Bot as ${chat.person_name}!*\n\n${statusMsg}\n\n${helpMsg}`,
        );
        if (res.ok) sent++;
      }
      return NextResponse.json({ ok: true, sent, activeChats: activeChats.length });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    service: "BITA Telegram Executive Bot Webhook",
    hasBotTokenEnv,
    hasWebhookSecretEnv,
  });
}
