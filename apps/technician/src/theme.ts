// BITA Design Tokens per DESIGN.md
export const colors = {
  background: "#ffffff",
  surface: "#fafafa",
  ink: "#0a0a0a",
  ink2: "#4d4d4d",
  ink3: "#8f8f8f",
  line: "#ebebeb",
  line2: "#f2f2f2",
  bad: "#dc2626",
  wait: "#d97706",
  ok: "#16a34a",
  info: "#2563eb",
  white: "#ffffff",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const typography = {
  header: {
    fontSize: 22,
    fontWeight: "600" as const,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: colors.ink,
  },
  body: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  sub: {
    fontSize: 13,
    color: colors.ink2,
  },
  caption: {
    fontSize: 12,
    color: colors.ink3,
  },
  mono: {
    fontFamily: "monospace",
    fontSize: 14,
    color: colors.ink,
  },
};
