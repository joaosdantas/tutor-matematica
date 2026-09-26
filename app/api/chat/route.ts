import { NextResponse } from "next/server";

const WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_THREAD_ID_LENGTH = 200;

export const maxDuration = 60;

type ChatRequestBody = {
  message: unknown;
  threadId: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  if (!WEBHOOK_URL) {
    console.error("MAKE_WEBHOOK_URL is not configured on the server.");
    return NextResponse.json(
      { error: "O tutor não está configurado neste momento." },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Requisição inválida: o corpo deve ser JSON." },
      { status: 400 },
    );
  }

  const message = cleanString(body?.message, MAX_MESSAGE_LENGTH);
  const threadId = cleanString(body?.threadId, MAX_THREAD_ID_LENGTH);

  if (!message) {
    return NextResponse.json(
      { error: "Envie uma pergunta antes de continuar." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!upstream.ok) {
      console.error(`Make webhook responded with status ${upstream.status}.`);
      return NextResponse.json(
        { error: "O tutor está indisponível agora. Tente novamente em instantes." },
        { status: 502 },
      );
    }

    const data: unknown = await upstream.json();
    const payload = data as { response?: unknown; threadId?: unknown };

    const response = cleanString(payload?.response, 100_000);
    const resolvedThreadId = cleanString(payload?.threadId, MAX_THREAD_ID_LENGTH);

    if (!response) {
      return NextResponse.json(
        { error: "O tutor retornou uma resposta vazia. Tente reformular a pergunta." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      response,
      threadId: resolvedThreadId || threadId,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.error(aborted ? "Make webhook timed out." : "Make webhook request failed.", error);
    return NextResponse.json(
      {
        error: aborted
          ? "O tutor demorou demais para responder. Tente novamente."
          : "Não foi possível falar com o tutor agora.",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
