import type { ChatMessage } from "@/types/chat";

const THREAD_ID_KEY = "tutor-matematica:threadId";
const MESSAGES_KEY = "tutor-matematica:messages";
const MAX_STORED_MESSAGES = 100;

const EMPTY_MESSAGES: ChatMessage[] = [];

const listeners = new Set<() => void>();

let cache: ChatMessage[] | null = null;

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage indisponível (modo privado, quota excedida): seguimos sem persistir.
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "tutor") &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "number"
  );
}

function parseMessages(raw: string | null): ChatMessage[] {
  if (!raw) return EMPTY_MESSAGES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_MESSAGES;
    return parsed.filter(isChatMessage);
  } catch {
    return EMPTY_MESSAGES;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Snapshot do cliente. Precisa devolver uma referência estável entre chamadas
 * para o React não entrar em laço de re-render.
 */
export function getMessages(): ChatMessage[] {
  if (cache === null) {
    cache = parseMessages(readStorage(MESSAGES_KEY));
  }
  return cache;
}

/** Snapshot do servidor: o histórico vive no navegador, então começa vazio. */
export function getServerMessages(): ChatMessage[] {
  return EMPTY_MESSAGES;
}

export function subscribeMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateMessages(
  updater: (previous: ChatMessage[]) => ChatMessage[],
): void {
  const next = updater(getMessages()).slice(-MAX_STORED_MESSAGES);
  cache = next;
  writeStorage(MESSAGES_KEY, JSON.stringify(next));
  emit();
}

export function getThreadId(): string {
  return readStorage(THREAD_ID_KEY) ?? "";
}

export function setThreadId(threadId: string): void {
  if (!threadId) return;
  writeStorage(THREAD_ID_KEY, threadId);
}

export function clearConversation(): void {
  cache = EMPTY_MESSAGES;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(THREAD_ID_KEY);
    window.localStorage.removeItem(MESSAGES_KEY);
  } catch {
    // ignora
  }
  emit();
}
