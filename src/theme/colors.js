// Blue-collar palette: navy authority, bright blue action, warm grey warmth.
// Everything sized for muddy gloves and sunlight glare.

export const colors = {
  navy: '#0F2C4A',       // primary text, headers
  navyDark: '#081B30',   // active press states
  blue: '#1E6BD6',       // primary CTA
  blueDark: '#1553AB',   // CTA press state
  blueLight: '#E8F1FD',  // CTA backgrounds/chips
  white: '#FFFFFF',
  bg: '#F4F6F9',         // app background - soft, not pure white (easier outdoors)
  card: '#FFFFFF',
  grey900: '#1A1F26',
  grey700: '#3D4653',
  grey500: '#6B7280',
  grey300: '#CBD2DB',
  grey200: '#E2E7EF',
  grey100: '#EEF1F6',
  success: '#2E8B57',
  warning: '#E8A317',
  danger: '#D64545',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

// Type scale - nothing smaller than 14. Body is 18 for gloves + glare.
export const type = {
  display: { fontSize: 34, fontWeight: '800', color: colors.navy, letterSpacing: -0.5 },
  h1: { fontSize: 28, fontWeight: '700', color: colors.navy },
  h2: { fontSize: 22, fontWeight: '700', color: colors.navy },
  body: { fontSize: 18, fontWeight: '500', color: colors.grey900 },
  bodyMuted: { fontSize: 18, fontWeight: '500', color: colors.grey500 },
  label: { fontSize: 16, fontWeight: '600', color: colors.grey700 },
  small: { fontSize: 14, fontWeight: '500', color: colors.grey500 },
  button: { fontSize: 20, fontWeight: '700', color: colors.white, letterSpacing: 0.2 },
};

export const shadow = {
  card: {
    shadowColor: '#0F2C4A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  button: {
    shadowColor: '#1553AB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
};
