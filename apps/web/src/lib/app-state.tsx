'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { messages, type Lang } from './i18n';

export type Theme = 'paper' | 'light' | 'dark';

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'ltr' | 'rtl';
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<AppState | null>(null);

const THEME_KEY = 'sw-theme';
const LANG_KEY = 'sw-lang';

function readStorage(key: string, { persist = false } = {}): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) ?? '';
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = readStorage(THEME_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'paper' ? (saved as Theme) : 'paper';
  });
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = readStorage(LANG_KEY);
    return saved === 'fa' ? 'fa' : 'en';
  });

  // Sync <html> attributes so RTL + fonts + theme apply globally.
  useEffect(() => {
    const doc = document.documentElement;
    doc.className = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'paper';
    doc.setAttribute('lang', lang);
    doc.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [theme, lang]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = messages[lang][key] ?? messages.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [lang],
  );

  return (
    <Ctx.Provider value={{ theme, setTheme, lang, setLang, dir: lang === 'fa' ? 'rtl' : 'ltr', t }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProviders');
  return ctx;
}

export const useT = () => useApp().t;
