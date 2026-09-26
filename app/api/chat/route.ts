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

/**
 * O cenário monta o JSON concatenando strings, então o LaTeX do modelo chega
 * com barras invertidas soltas (`\(`) e quebras de linha cruas. Ambos são
 * inválidos dentro de uma string JSON e fazem o `JSON.parse` estrito estourar.
 * Reescapa esses dois casos sem tocar no restante da estrutura.
 */
function parseUpstreamJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(escapeLooseJsonStrings(text));
  }
}

const VALID_JSON_ESCAPES = '\\/"bfnrtu';

/**
 * `\f`, `\b`, `\t` e `\r` são sequências de escape válidas em JSON, então o
 * `JSON.parse` converte de forma silenciosa: `\frac` vira form feed + "rac" e a
 * barra some. Controlados por um cenário que monta o JSON concatenando string.
 * Nenhum desses caracteres tem uso legítimo em Markdown, exceto o tab de
 * indentação — restaurado apenas quando aparece no meio de um token.
 */
function restoreLatexCommands(text: string): string {
  return text
    .replace(/\f/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\r/g, "\\r")
    .replace(/(?<=\S)\t/g, "\\t");
}

function escapeLooseJsonStrings(text: string): string {
  let out = "";
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "\\") {
      const next = text[index + 1];
      if (next !== undefined && VALID_JSON_ESCAPES.includes(next)) {
        out += char + next;
        index += 1;
      } else {
        out += "\\\\";
      }
      continue;
    }

    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }

    if (!inString || char.charCodeAt(0) >= 0x20) {
      out += char;
      continue;
    }

    if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else out += "\\u0000";
  }

  return out;
}

/**
 * O modelo responde com os delimitadores do LaTeX puro (`\(...\)`, `\[...\]`),
 * que o remark-math não tokeniza. Converte para a sintaxe Markdown que o
 * pipeline de KaTeX entende.
 *
 * Percorre caractere a caractere porque `\\[4pt]` — quebra de linha com
 * espaçamento, usada nos ambientes `align` — contém a sequência `\[` sem ser
 * um delimitador. Um regex trataria isso como abertura de display e engoliria o
 * conteúdo até o próximo `\]`.
 */
function normalizeMathDelimiters(text: string): string {
  let out = "";
  let open: "display" | "inline" | null = null;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char !== "\\") {
      out += char;
      index += 1;
      continue;
    }

    const next = text[index + 1];

    if (next === "\\") {
      out += next;
      index += 2;
      continue;
    }

    if (next === "[" && open === null) {
      out += "$$";
      open = "display";
      index += 2;
      continue;
    }

    if (next === "]" && open === "display") {
      out += "$$";
      open = null;
      index += 2;
      continue;
    }

    if (next === "(" && open === null) {
      out += "$";
      open = "inline";
      index += 2;
      continue;
    }

    if (next === ")" && open === "inline") {
      out += "$";
      open = null;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
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

    const rawBody = await upstream.text();
    const payload = parseUpstreamJson(rawBody) as {
      response?: unknown;
      threadId?: unknown;
    } | null;

    const response = cleanString(payload?.response, 100_000);
    const resolvedThreadId = cleanString(payload?.threadId, MAX_THREAD_ID_LENGTH);

    if (!response) {
      return NextResponse.json(
        { error: "O tutor retornou uma resposta vazia. Tente reformular a pergunta." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      response: normalizeMathDelimiters(restoreLatexCommands(response)),
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
