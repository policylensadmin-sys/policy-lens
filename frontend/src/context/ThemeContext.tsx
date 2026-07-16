import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * User-selectable color mode. `system` follows the OS `prefers-color-scheme`
 * media query and updates live when the OS setting changes; `light` and `dark`
 * pin the palette explicitly. The chosen mode is persisted to localStorage.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** The concrete palette actually applied to the DOM (never `system`). */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'policylens-theme';

interface ThemeContextValue {
  /** The user's selected mode (light / dark / system). */
  mode: ThemeMode;
  /** The concrete palette in effect right now (light / dark). */
  resolvedTheme: ResolvedTheme;
  /** Set an explicit mode. */
  setMode: (mode: ThemeMode) => void;
  /** Convenience: cycle System → Light → Dark → System. */
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Global theme provider. Owns the color-mode selection, resolves it against
 * the OS preference, applies `data-theme` to <html>, and persists the choice.
 * Mount once at the app root.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme(),
  );

  // Track OS-level preference changes so `system` stays in sync live.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = mode === 'system' ? systemTheme : mode;

  // Apply the resolved palette to <html> and persist the chosen mode.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures (e.g. private mode) */
    }
  }, []);

  const cycleMode = useCallback(() => {
    setMode(mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system');
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode, cycleMode }),
    [mode, resolvedTheme, setMode, cycleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the theme mode and controls. Must be used within a ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export { ThemeContext };
