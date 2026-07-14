---
name: Ascent Design System
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c1caaf'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8c947b'
  outline-variant: '#424a35'
  surface-tint: '#93db00'
  primary: '#ffffff'
  on-primary: '#213600'
  primary-container: '#aef831'
  on-primary-container: '#496f00'
  inverse-primary: '#446900'
  secondary: '#c8c6c5'
  on-secondary: '#303030'
  secondary-container: '#474746'
  on-secondary-container: '#b7b5b4'
  tertiary: '#ffffff'
  on-tertiary: '#303030'
  tertiary-container: '#e4e2e1'
  on-tertiary-container: '#656464'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#aef831'
  primary-fixed-dim: '#93db00'
  on-primary-fixed: '#121f00'
  on-primary-fixed-variant: '#324f00'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1b1b1c'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e4e2e1'
  tertiary-fixed-dim: '#c8c6c5'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  data-display:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  touch-target-min: 48px
---

## Brand & Style
The brand personality is high-performance, disciplined, and utilitarian. It targets athletes who value precision and progress over social fluff. The UI should evoke a sense of kinetic energy and focus, using a "Dark Performance" aesthetic.

The design style is a hybrid of **Modern Minimalism** and **High-Contrast Sport**. It utilizes deep obsidian surfaces to reduce eye strain during workouts, punctuated by a singular, aggressive lime-green accent to highlight success and action. Layouts are structured around functional card modules that prioritize data density without sacrificing legibility.

## Colors
The palette is dominated by **Deep Anthracite (#121212)** for the base background to provide a premium, "stealth" feel. 

- **Primary (Lime-Green):** Used exclusively for high-priority CTAs, progress bars, and active states. It must always maintain a high contrast ratio against the dark background.
- **Surface Layers:** Secondary (#1E1E1E) and Tertiary (#2C2C2C) are used to define card boundaries and nested UI elements.
- **Typography Colors:** Pure White (#FFFFFF) for headers and critical data; Medium Grey (#A0A0A0) for labels and metadata to maintain visual hierarchy.

## Typography
The system uses **Inter** for its neutral, highly legible character. 

- **Numerical Data:** For weight (kg), reps, and timers, use `data-display` or `headline-lg` with tabular lining figures to ensure numbers align perfectly in lists.
- **Hierarchy:** Use heavy weights (700-800) for primary headers to create a "bold" sporty feel.
- **Language:** German text often requires more horizontal space; ensure containers have flexible widths for longer words like "Wiederholungen" or "Trainingseinheit."

## Layout & Spacing
The layout follows a 4px baseline grid. 

- **Mobile (Android):** 4-column fluid grid with 16px margins and 12px gutters. All interactive elements must adhere to the 48x48dp minimum touch target.
- **Desktop (Web):** 12-column fixed grid (max-width 1200px) with 24px gutters. Content should be centered with ample side margins.
- **Rhythm:** Use `lg` (24px) for vertical spacing between distinct card modules and `md` (16px) for internal card padding.

## Elevation & Depth
Depth is created through **Tonal Layering** rather than traditional shadows. 

- **Level 0 (Base):** #121212.
- **Level 1 (Cards/Main UI):** #1E1E1E with a subtle 1px inner stroke of #2C2C2C to define edges.
- **Level 2 (Modals/Popovers):** #2C2C2C.
- **Gradients:** Use very subtle linear gradients on primary buttons (e.g., #B4FF39 to #8EDD20) to provide a slight tactile feel without veering into full skeuomorphism. High-contrast outlines are used for secondary button states.

## Shapes
The shape language is "Functional Rounded." 

- **Standard Cards/Buttons:** Use `rounded` (0.5rem / 8px) for a modern, approachable feel that still looks structured.
- **Progress Bars:** Use fully rounded (pill-shaped) ends to emphasize movement and fluidity.
- **Inputs:** Match the card roundedness (8px) for consistency.

## Components

- **Buttons:** 
  - *Primary (Aktion):* #B4FF39 fill with black text. Bold weight. Height: 48px or 56px.
  - *Secondary:* Ghost style with 1px white or lime border.
- **Progress Tracks:** Background of track is #2C2C2C, fill is #B4FF39. For "over-achieving" goals, use a secondary color or a pulse animation.
- **Cards (Module):** Background #1E1E1E. Use for individual exercises or nutrition summaries. Cards should have a clear header (`label-sm`) and a primary data point (`data-display`).
- **Input Fields:** Darker background (#121212) than the card they sit on. Active state indicated by a #B4FF39 bottom border or focus ring.
- **Chips (Filter):** Small pills with #2C2C2C background. When active, they switch to #B4FF39 with black text.
- **List Items:** High-density, 64px minimum height. Use thin dividers (#2C2C2C) between workout sets.
- **Floating Action Button (FAB):** Android specific. 56x56dp, color #B4FF39, used for "Start Workout" (Training starten).