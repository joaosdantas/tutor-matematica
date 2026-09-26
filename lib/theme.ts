export type Theme = "light" | "dark";

const THEME_KEY = "tutor-matematica:theme";

const listeners = new Set<() => void>();

let cache: Theme | null = null;
let mediaQuery: MediaQueryList | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function readStored(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function handleSystemChange(): void {
  if (readStored() !== null) return;
  cache = systemTheme();
  apply(cache);
  emit();
}

/**
 * A assinatura é única do módulo: o cenário só deve mudar sozinho enquanto o
 * usuário não tiver escolhido um tema explícito.
 */
function ensureMediaQuery(): void {
  if (typeof window === "undefined" || !window.matchMedia) return;
  if (mediaQuery) return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", handleSystemChange);
}

export function getTheme(): Theme {
  if (cache === null) {
    cache = readStored() ?? systemTheme();
    apply(cache);
  }
  return cache;
}

/** Snapshot do servidor: o tema vive no navegador, então o HTML nasce claro. */
export function getServerTheme(): Theme {
  return "light";
}

export function subscribeTheme(listener: () => void): () => void {
  ensureMediaQuery();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTheme(theme: Theme): void {
  cache = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage indisponível: o tema ainda funciona na sessão atual.
  }
  apply(theme);
  emit();
}

export function toggleTheme(): void {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}
