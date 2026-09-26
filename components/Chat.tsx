"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Markdown } from "@/components/Markdown";
import {
  clearConversation,
  getMessages,
  getServerMessages,
  getThreadId,
  setThreadId,
  subscribeMessages,
  updateMessages,
} from "@/lib/thread-storage";
import { toggleTheme } from "@/lib/theme";
import type { ChatApiError, ChatApiSuccess, ChatMessage } from "@/types/chat";

const SUGGESTIONS = [
  "Como resolvo uma equação do segundo grau?",
  "Explique derivada com um exemplo simples",
  "Qual a fórmula da área de um círculo?",
];

function subscribe(): () => void {
  return () => {};
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Chat() {
  const messages = useSyncExternalStore(
    subscribeMessages,
    getMessages,
    getServerMessages,
  );

  // `false` no servidor, `true` no cliente: habilita o composer só depois
  // que o histórico e o threadId do localStorage foram lidos.
  const isReady = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const text = rawMessage.trim();
    if (!text || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    setInput("");

    updateMessages((previous) => [
      ...previous,
      { id: createId(), role: "user", content: text, createdAt: Date.now() },
    ]);

    let threadId = getThreadId();
    if (!threadId) {
      threadId = createId();
      setThreadId(threadId);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, threadId }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          (data as ChatApiError)?.error ??
          "Não foi possível obter a resposta do tutor.";
        throw new Error(message);
      }

      const payload = data as ChatApiSuccess;
      setThreadId(payload.threadId?.trim() || threadId);

      updateMessages((previous) => [
        ...previous,
        {
          id: createId(),
          role: "tutor",
          content: payload.response,
          createdAt: Date.now(),
        },
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Ocorreu um erro inesperado. Tente novamente.",
      );
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  function handleReset() {
    clearConversation();
    setError(null);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <div className="chat__brand">
          <span className="chat__logo" aria-hidden="true">
            &pi;
          </span>
          <div>
            <h1 className="chat__title">Tutor de Matemática</h1>
            <p className="chat__subtitle">Faça perguntas e veja as fórmulas resolvidas</p>
          </div>
        </div>
        <div className="chat__actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Alternar tema"
          >
            <svg
              className="theme-toggle__icon theme-toggle__icon--moon"
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8Z" />
            </svg>
            <svg
              className="theme-toggle__icon theme-toggle__icon--sun"
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.4v2.2M12 19.4v2.2M4.2 12H2M22 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5" />
            </svg>
          </button>
          <button
            type="button"
            className="chat__reset"
            onClick={handleReset}
            disabled={messages.length === 0 && !error}
          >
            Nova conversa
          </button>
        </div>
      </header>

      <main className="chat__messages" aria-live="polite" aria-busy={isLoading}>
        {messages.length === 0 ? (
          <div className="chat__empty">
            <h2>Olá! Sou seu tutor de matemática.</h2>
            <p>
              Escreva sua dúvida abaixo. Use <code>$...$</code> para fórmulas
              inline e <code>$$...$$</code> para expressões maiores.
            </p>
            <ul className="chat__suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="chat__suggestion"
                    onClick={() => void sendMessage(suggestion)}
                    disabled={!isReady || isLoading}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((message: ChatMessage) => (
            <article key={message.id} className={`bubble bubble--${message.role}`}>
              <span className="bubble__role">
                {message.role === "user" ? "Você" : "Tutor"}
              </span>
              <div className="bubble__body">
                {message.role === "user" ? (
                  <p className="bubble__plain">{message.content}</p>
                ) : (
                  <Markdown>{message.content}</Markdown>
                )}
              </div>
            </article>
          ))
        )}

        {isLoading && (
          <article className="bubble bubble--tutor">
            <span className="bubble__role">Tutor</span>
            <div className="bubble__body">
              <span className="typing" role="status" aria-label="Tutor digitando">
                <span className="typing__dot" />
                <span className="typing__dot" />
                <span className="typing__dot" />
              </span>
            </div>
          </article>
        )}

        {error && (
          <p className="chat__error" role="alert">
            {error}
          </p>
        )}

        <div ref={messagesEndRef} />
      </main>

      <form className="chat__composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="chat-input">
          Sua pergunta
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="chat__input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua dúvida de matemática..."
          rows={1}
          disabled={!isReady}
        />
        <button
          type="submit"
          className="chat__send"
          disabled={!isReady || isLoading || input.trim().length === 0}
        >
          {isLoading ? "Enviando..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
