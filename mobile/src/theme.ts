/**
 * Mirrors the neobrutalist palette used by the web frontend (app/globals.css and
 * the Tailwind classes in app/demo/page.tsx) so both clients read as one product.
 */
export const colors = {
  background: '#fffdf7',
  surface: '#ffffff',
  border: '#000000',
  text: '#000000',
  muted: '#5c5c5c',

  yellow: '#ffe900',
  pink: '#ff90e8',
  cyan: '#00f0ff',
  teal: '#14b8a6',
  orange: '#ffb000',
  purple: '#b19cd9',
  red: '#ef4444',
} as const;

/** Status -> accent colour, matching the banner colours on the web job page. */
export const statusColors = {
  QUEUED: colors.orange,
  PROCESSING: colors.pink,
  COMPLETED: colors.teal,
  FAILED: colors.red,
} as const;

export const priorityColors = {
  HIGH: colors.red,
  MEDIUM: colors.orange,
  LOW: colors.cyan,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const borderWidth = 4;

/**
 * The web app draws hard offset shadows with `shadow-[8px_8px_0px_0px_#000]`.
 * React Native has no equivalent box-shadow primitive that renders identically
 * across platforms, so `<Card>` fakes it with an offset black View behind the
 * content. This is the offset those cards use.
 */
export const shadowOffset = 6;
