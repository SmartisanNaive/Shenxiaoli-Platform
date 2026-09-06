---
name: Deep Forest Emerald Academic
colors:
  surface: '#f9faf6'
  surface-dim: '#dadad7'
  surface-bright: '#f9faf6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f1'
  surface-container: '#eeeeeb'
  surface-container-high: '#e8e8e5'
  surface-container-highest: '#e2e3e0'
  on-surface: '#1a1c1a'
  on-surface-variant: '#414844'
  inverse-surface: '#2f312f'
  inverse-on-surface: '#f0f1ee'
  outline: '#717973'
  outline-variant: '#c1c8c2'
  surface-tint: '#3f6653'
  primary: '#012d1d'
  on-primary: '#ffffff'
  primary-container: '#1b4332'
  on-primary-container: '#86af99'
  inverse-primary: '#a5d0b9'
  secondary: '#2c694e'
  on-secondary: '#ffffff'
  secondary-container: '#aeeecb'
  on-secondary-container: '#316e52'
  tertiary: '#1b2923'
  on-tertiary: '#ffffff'
  tertiary-container: '#313f39'
  on-tertiary-container: '#9baaa2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c1ecd4'
  primary-fixed-dim: '#a5d0b9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#274e3d'
  secondary-fixed: '#b1f0ce'
  secondary-fixed-dim: '#95d4b3'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#0e5138'
  tertiary-fixed: '#d6e6dd'
  tertiary-fixed-dim: '#bacac2'
  on-tertiary-fixed: '#111e19'
  on-tertiary-fixed-variant: '#3c4a43'
  background: '#f9faf6'
  on-background: '#1a1c1a'
  surface-variant: '#e2e3e0'
typography:
  headline-xl:
    fontFamily: Source Serif 4
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 52px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Source Serif 4
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  headline-sm:
    fontFamily: Source Serif 4
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  grid-max-width: 1200px
  column-count: '12'
  gutter: 24px
  margin: 32px
  space-xs: 4px
  space-sm: 8px
  space-md: 16px
  space-lg: 24px
  space-xl: 32px
  space-2xl: 48px
  space-3xl: 64px
---

## Brand & Style

This design system establishes a restrained, scholarly, and modern aesthetic tailored for the Shenzhen University of Advanced Technology (SUAT) campus platform, "深小狸校园". The brand personality is grounded, intellectual, highly professional, and deeply rooted in a natural, organic academic tradition.

The visual language rejects all blue tones in favor of a sophisticated botanical palette dominated by deep forest greens, crisp off-white backgrounds, and authoritative typographic hierarchy. The UI evokes a sense of tranquil focus, institutional reliability, and contemporary clarity, prioritizing generous whitespace, high legibility, and structured information architecture fit for a leading research institution.

## Colors

The color palette is strictly disciplined, utilizing an all-green and neutral ecosystem completely devoid of blue undertones.

- **Primary (#1B4332):** Forest Emerald, serving as the anchor for primary navigation, high-emphasis actions, and institutional branding.
- **Pine Green (#2D6A4F):** Used for interactive states, secondary buttons, and supporting highlights.
- **Sage (#D8E8DF):** A soft, muted green tone applied for subtle containers, active table rows, and positive status indicators.
- **Off-White (#F6F7F3):** The foundational canvas background, reducing eye strain and establishing a warm, paper-like academic feel.
- **White (#FFFFFF):** Used for elevated cards, modals, and input fields to create crisp modular separation.
- **Body Text (#202622):** A deeply grounded dark charcoal green offering exceptional contrast and readability for long-form academic reading.
- **Secondary Text (#69736D):** A muted green-gray used for metadata, captions, and de-emphasized UI labels.
- **Border (#DDE3DF):** A fine, restrained line color for structural dividers and input outlines.

## Typography

The typographic system pairs the authoritative, literary grace of **Source Serif 4** for headlines with the clean, friendly, and precise geometry of **Plus Jakarta Sans** for body and interface text.

This juxtaposition balances academic gravitas with digital-native usability. Headlines maintain generous line heights and subtle negative tracking on larger sizes, while body text is optimized for extended periods of reading across research publications, campus announcements, and utility dashboards. For mobile viewports, scale down any headline exceeding 32px to ensure optimal wrapping and visual balance.

## Layout & Spacing

This design system utilizes a structured **fixed grid** layout model (max-width 1200px on desktop) with generous margins and consistent 24px gutters, establishing an open, breathable canvas that mirrors the physical architecture of a modern campus.

- **Desktop:** 12-column grid with 32px outer margins, emphasizing centralized, focused reading columns and expansive whitespace.
- **Tablet:** 8-column layout with 24px gutters and 24px margins, allowing sidebars to collapse gracefully.
- **Mobile:** 4-column fluid layout with 16px margins and vertical stacking. Information density remains airy, with consistent 16px to 32px vertical rhythm between component blocks.

## Elevation & Depth

Visual hierarchy is achieved through a hybrid of tonal surface layers and low-contrast outlines rather than heavy drop shadows, reinforcing the clean, restrained academic identity.

- **Flat Foundation:** Base canvases utilize the Off-White background (`#F6F7F3`).
- **Surface Elevation:** Cards, navigation bars, and dropdowns sit on pure White (`#FFFFFF`) surfaces separated by fine structural borders (`#DDE3DF`).
- **Ambient Shadows:** Where elevation is strictly required (e.g., floating action buttons, modals), apply extremely soft, diffused shadows tinted with deep forest green (`rgba(27, 67, 50, 0.08)`), avoiding any harsh black or blue-tinted drop effects.

## Shapes

A soft, restrained geometric language (`roundedness` level 1) is employed across all UI components.

- **Containers & Cards:** Default border-radius is set to 0.25rem (4px) or 0.375rem (6px) to maintain a crisp, professional, paper-like utility.
- **Buttons & Inputs:** Subtly rounded edges provide approachability without sacrificing institutional seriousness.
- **Pills & Badges:** Fully rounded (pill-shaped) variants are reserved exclusively for status indicators, category tags, and notification counters.

## Components

- **Buttons:** Primary buttons feature a solid Forest Emerald (`#1B4332`) fill with white text, subtle hover states transitioning to Pine Green (`#2D6A4F`), and a 4px border radius. Secondary buttons use a white background with a border (`#DDE3DF`) and body text, while ghost buttons remain borderless until hovered.
- **Chips & Tags:** Use Sage (`#D8E8DF`) as a background container with dark body text for categorization, research tags, and filter selections.
- **Lists:** Clean typographic lists featuring generous vertical spacing (`space-md`), separated by hairline dividers (`#DDE3DF`) rather than solid blocks.
- **Checkboxes & Radio Buttons:** Custom-styled square (checkbox) and circular (radio) inputs featuring a 2px border in secondary text color, filling solidly with Forest Emerald when checked.
- **Input Fields:** Built on white surfaces with a standard border (`#DDE3DF`), 4px radius, and clear placeholder text in secondary text color. On focus, the border transitions cleanly to Forest Emerald.
- **Cards:** White surfaces resting on the off-white canvas, framed by a delicate border, housing course modules, campus announcements, or user profile summaries with ample internal padding.
- **Additional Components:** Implement academic schedule grids, citation blockquotes with vertical accent bars, and notification banners utilizing the Sage tone for informational alerts.
