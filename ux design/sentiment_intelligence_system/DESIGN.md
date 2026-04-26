---
name: Sentiment Intelligence System
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
  on-surface-variant: '#c1c6d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8b90a0'
  outline-variant: '#414755'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e69'
  primary-container: '#4b8eff'
  on-primary-container: '#00285c'
  inverse-primary: '#005bc1'
  secondary: '#ecffe3'
  on-secondary: '#003907'
  secondary-container: '#13ff43'
  on-secondary-container: '#007117'
  tertiary: '#ffb4ab'
  on-tertiary: '#690006'
  tertiary-container: '#ff544b'
  on-tertiary-container: '#5c0005'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#72ff70'
  secondary-fixed-dim: '#00e639'
  on-secondary-fixed: '#002203'
  on-secondary-fixed-variant: '#00530e'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb4ab'
  on-tertiary-fixed: '#410002'
  on-tertiary-fixed-variant: '#93000c'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  data-mono:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: -0.01em
  label-xs:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  container-padding: 20px
  stack-sm: 8px
  stack-md: 16px
---

## Brand & Style

This design system is engineered for high-stakes financial decision-making, where speed of comprehension is the primary metric of success. The brand personality is **Authoritative, Kinetic, and Precise**. It targets institutional traders and quantitative analysts who require a "Bloomberg-level" density of information filtered through a modern, AI-first lens.

The aesthetic fuses **Minimalism** with **Glassmorphism**. By stripping away unnecessary chrome and using light-refractive layers, the system directs focus toward real-time sentiment shifts. The emotional response is one of "calm amidst the storm"—providing the user with a sense of control over volatile market data through structured, high-contrast visual hierarchies.

## Colors

The palette is anchored in an "Absolute Dark" environment to minimize ocular strain during extended sessions. The core background is a deep black (#080808), while interactive surfaces utilize charcoal (#121212).

Semantic intensity is dialed to the maximum:
- **Neon Green (#00FF41):** Reserved strictly for bullish sentiment and positive percentage changes.
- **Vivid Red (#FF3131):** Used for bearish indicators and high-risk alerts.
- **Amber (#FFBF00):** Indicates neutral sentiment or system warnings.
- **Electric Blue (#007AFF):** The primary systemic color for AI status, primary buttons, and active focus states.
- **Grayscale:** Text utilizes a high-contrast white (#FFFFFF) for primary headers, stepping down to a muted gray (#8E8E93) for metadata.

## Typography

This design system utilizes **Inter** exclusively to leverage its tall x-height and exceptional legibility at small sizes. The typographic scale is optimized for "Data Density":

- **Numerical Data:** Use `data-mono` for all price points and percentages to ensure vertical alignment in tables.
- **Headlines:** Use tight letter-spacing (-0.02em) to maintain a sleek, technical appearance.
- **Labels:** Small, all-caps treatments are used for secondary UI elements like table headers and chart axes to maximize the "Command Center" aesthetic.
- **Contrast:** High contrast is maintained by using pure white for critical data and reduced opacity (60-70%) for supporting text.

## Layout & Spacing

The layout utilizes a **12-column fluid grid** with strict 16px gutters. It is designed to be "Screen-Filling," eliminating unnecessary whitespace to keep as much data "above the fold" as possible.

A 4px baseline grid governs all internal component spacing. Larger containers (Cards) use a standard 20px internal padding. In data-dense areas, such as the live sentiment feed, vertical spacing is compressed to 8px to prioritize information volume over airiness.

## Elevation & Depth

Depth is communicated through **Glassmorphism and Tonal Layering** rather than traditional shadows.

1.  **Level 0 (Floor):** Pure black (#080808) for the global background.
2.  **Level 1 (Cards):** Deep charcoal (#121212) with a 1px border of `glass-stroke`.
3.  **Level 2 (Overlays/Modals):** A semi-transparent surface (rgba(30, 30, 30, 0.8)) with a 20px backdrop-blur to create a "frosted glass" effect.
4.  **Accents:** Subtle radial gradients are used behind high-priority sentiment gauges to create a "glow" that suggests active AI processing.

## Shapes

The shape language is **Soft-Technical**. A base radius of 4px (`roundedness: 1`) is applied to buttons and input fields to maintain a professional, sharp edge. 

Large dashboard cards use a slightly more generous 8px radius (`rounded-lg`) to differentiate structural sections. Circular elements (pills) are reserved exclusively for status indicators and sentiment badges to make them instantly recognizable against the rectangular grid.

## Components

- **Sentiment Cards:** Utilize glassmorphism with a subtle "inner glow" corresponding to the sentiment color (Green/Red). They must include a sparkline at the bottom edge.
- **Data Tables:** Borderless design. Use alternating row highlights on hover using a 4% white overlay. Headers are `label-xs` with a subtle bottom divider.
- **Sentiment Gauges:** Semi-circular indicators with a high-glow "needle." The track color should be a muted version of the semantic palette.
- **Live Feed Items:** Feature a "pulse" micro-interaction (2px dot) in the corner to indicate real-time updates.
- **Buttons:** 
    - *Primary:* Electric Blue background, white text, no border.
    - *Secondary:* Ghost style with a 1px white border at 20% opacity.
- **Sparklines:** Vector-based paths with a gradient fill (opacity 20% to 0%) to visualize the trend direction without cluttering the card.
- **Input Fields:** Darker than the card background (#000000), with a 1px Electric Blue border on focus.