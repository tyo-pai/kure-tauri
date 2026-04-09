import { Platform } from 'react-native';

export type ThemeName = 'light' | 'dark';

export interface MobileTheme {
  name: ThemeName;
  colors: {
    bg: string;
    surface: string;
    surfaceSolid: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    accent: string;
    accentDestructive: string;
    success: string;
    successBg: string;
    link: string;
    inputBg: string;
    overlay: string;
  };
  fonts: {
    sans: string;
    mono: string;
  };
  radii: {
    card: number;
    input: number;
    pill: number;
  };
  spacing: {
    pageX: number;
    pageTop: number;
    sectionGap: number;
    cardPad: number;
  };
  type: {
    hero: number;
    body: number;
    small: number;
    micro: number;
  };
}

const fonts = {
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
};

export const lightTheme: MobileTheme = {
  name: 'light',
  colors: {
    bg: '#f5f5f5',
    surface: 'rgba(255, 255, 255, 0.8)',
    surfaceSolid: '#ffffff',
    border: '#e5e5e5',
    textPrimary: '#0a0a0a',
    textSecondary: '#737373',
    textTertiary: '#a3a3a3',
    accent: '#141414',
    accentDestructive: '#d44',
    success: '#166534',
    successBg: 'rgba(34, 197, 94, 0.08)',
    link: '#4a9eff',
    inputBg: '#ffffff',
    overlay: 'rgba(0, 0, 0, 0.04)',
  },
  fonts,
  radii: {
    card: 12,
    input: 4,
    pill: 14,
  },
  spacing: {
    pageX: 20,
    pageTop: 52,
    sectionGap: 14,
    cardPad: 16,
  },
  type: {
    hero: 30,
    body: 15,
    small: 11,
    micro: 9.5,
  },
};

export const darkTheme: MobileTheme = {
  name: 'dark',
  colors: {
    bg: '#0a0a0a',
    surface: 'rgba(30, 30, 30, 0.8)',
    surfaceSolid: '#1e1e1e',
    border: '#262626',
    textPrimary: '#fafafa',
    textSecondary: '#a3a3a3',
    textTertiary: '#525252',
    accent: '#fafafa',
    accentDestructive: '#e55',
    success: '#86efac',
    successBg: 'rgba(34, 197, 94, 0.08)',
    link: '#5aafff',
    inputBg: '#0d0d0d',
    overlay: 'rgba(255, 255, 255, 0.03)',
  },
  fonts,
  radii: {
    card: 12,
    input: 4,
    pill: 14,
  },
  spacing: {
    pageX: 20,
    pageTop: 52,
    sectionGap: 14,
    cardPad: 16,
  },
  type: {
    hero: 30,
    body: 15,
    small: 11,
    micro: 9.5,
  },
};

export function getTheme(colorScheme: string | null | undefined): MobileTheme {
  return colorScheme === 'dark' ? darkTheme : lightTheme;
}
