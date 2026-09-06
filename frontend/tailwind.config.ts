import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS configuration.
 *
 * Design tokens are sourced from the "Deep Forest Emerald Academic"
 * system defined in `docs/DESIGN.md`. Keep this file in sync with
 * the design system documentation.
 */
const config: Config = {
  content: ['./src/**/*.{html,ts,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#f9faf6',
        'surface-dim': '#dadad7',
        'surface-bright': '#f9faf6',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f3f4f1',
        'surface-container': '#eeeeeb',
        'surface-container-high': '#e8e8e5',
        'surface-container-highest': '#e2e3e0',
        'on-surface': '#1a1c1a',
        'on-surface-variant': '#414844',
        'inverse-surface': '#2f312f',
        'inverse-on-surface': '#f0f1ee',
        outline: '#717973',
        'outline-variant': '#c1c8c2',
        'surface-tint': '#3f6653',
        primary: {
          DEFAULT: '#012d1d',
          container: '#1b4332',
        },
        'on-primary': '#ffffff',
        'on-primary-container': '#86af99',
        'inverse-primary': '#a5d0b9',
        secondary: {
          DEFAULT: '#2c694e',
          container: '#aeeecb',
        },
        'on-secondary': '#ffffff',
        'on-secondary-container': '#316e52',
        tertiary: {
          DEFAULT: '#1b2923',
          container: '#313f39',
        },
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#9baaa2',
        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
        'primary-fixed': '#c1ecd4',
        'primary-fixed-dim': '#a5d0b9',
        'on-primary-fixed': '#002114',
        'on-primary-fixed-variant': '#274e3d',
        'secondary-fixed': '#b1f0ce',
        'secondary-fixed-dim': '#95d4b3',
        'on-secondary-fixed': '#002114',
        'on-secondary-fixed-variant': '#0e5138',
        'tertiary-fixed': '#d6e6dd',
        'tertiary-fixed-dim': '#bacac2',
        'on-tertiary-fixed': '#111e19',
        'on-tertiary-fixed-variant': '#3c4a43',
        background: '#f9faf6',
        'on-background': '#1a1c1a',
        'surface-variant': '#e2e3e0',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        'space-xs': '4px',
        'space-sm': '8px',
        'space-md': '16px',
        'space-lg': '24px',
        'space-xl': '32px',
        'space-2xl': '48px',
        'space-3xl': '64px',
        gutter: '24px',
        margin: '32px',
        'grid-max-width': '1200px',
      },
      fontFamily: {
        'body-sm': ['Plus Jakarta Sans', 'sans-serif'],
        'body-md': ['Plus Jakarta Sans', 'sans-serif'],
        'body-lg': ['Plus Jakarta Sans', 'sans-serif'],
        'label-md': ['Plus Jakarta Sans', 'sans-serif'],
        'label-sm': ['Plus Jakarta Sans', 'sans-serif'],
        'headline-sm': ['"Source Serif 4"', 'serif'],
        'headline-md': ['"Source Serif 4"', 'serif'],
        'headline-lg': ['"Source Serif 4"', 'serif'],
        'headline-xl': ['"Source Serif 4"', 'serif'],
      },
      fontSize: {
        'body-sm': ['13px', { lineHeight: '18px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '22px', fontWeight: '400' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'label-sm': [
          '12px',
          { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' },
        ],
        'label-md': [
          '14px',
          { lineHeight: '20px', letterSpacing: '0.01em', fontWeight: '500' },
        ],
        'headline-sm': ['20px', { lineHeight: '28px', fontWeight: '500' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '500' }],
        'headline-lg': [
          '32px',
          { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' },
        ],
        'headline-xl': [
          '40px',
          { lineHeight: '52px', letterSpacing: '-0.01em', fontWeight: '600' },
        ],
      },
      boxShadow: {
        'card-soft': '0 1px 8px rgba(27, 67, 50, 0.04)',
        'card-hover': '0 4px 14px rgba(27, 67, 50, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
