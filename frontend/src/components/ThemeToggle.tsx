import { useTheme, type ThemeMode } from '../context/ThemeContext';

/**
 * Navbar theme switcher. Cycles System → Light → Dark and shows the current
 * mode with an icon + label. Defaults to System, which follows the OS
 * `prefers-color-scheme` preference.
 */
const ICONS: Record<ThemeMode, string> = {
  system: '🖥️',
  light: '☀️',
  dark: '🌙',
};

const LABELS: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

interface ThemeToggleProps {
  /** Render compact (icon only) — useful for tight navbars. */
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const { mode, cycleMode } = useTheme();

  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={`Theme: ${LABELS[mode]}. Click to change.`}
      title={`Theme: ${LABELS[mode]} (click to change)`}
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary ${className}`}
    >
      <span aria-hidden="true">{ICONS[mode]}</span>
      {!compact && <span className="font-medium">{LABELS[mode]}</span>}
    </button>
  );
}

export default ThemeToggle;
