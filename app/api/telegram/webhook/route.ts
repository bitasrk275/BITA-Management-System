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

export async function POST(req: Request) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (expectedSecret) {
      const provided = req.headers.get("x-telegram-bot-api-secret-token")?.trim();
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

    // Handle /start <6-digit-code>
    const startMatch = /^\/start\s+(\d{6})$/i.exec(text);
    if (startMatch) {
      const code = startMatch[1];
      const redeemed = await redeemTelegramLinkCode(
        supabase,
        code,
        chatId,
        msg?.from?.username ?? msg?.from?.first_name ?? null,
      );

      if (!redeemed.ok) {
        await sendTelegramMessage(
          config.bot_token,
          chatId,
          `❌ *Pairing Failed:* ${redeemed.error}`,
        );
        return NextResponse.json({ ok: true, paired: false });
      }

      const welcome = await answerTelegramExecutiveQuery(supabase, "/help");
      await sendTelegramMessage(
        config.bot_token,
        chatId,
        `✅ *Connected to BITA Executive Bot as ${redeemed.personName}!*\n\n${welcome}`,
      );
      return NextResponse.json({ ok: true, paired: true });
    }

    const isLinked = links.chats.some((c) => c.chat_id === chatId && c.active);
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
      const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
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

  return NextResponse.json({
    ok: true,
    service: "BITA Telegram Executive Bot Webhook",
    hasBotTokenEnv,
    hasWebhookSecretEnv,
  });
}
