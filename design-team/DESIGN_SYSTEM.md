# Design system

Name: Midnight Local. One accent, taken from the mark in `site/assets/logo.svg`.

## Color

| Token | Value | Use |
|---|---|---|
| `--bbn-paper` | `#0B0D12` | Page background |
| `--bbn-surface` | `#12151C` | Cards, header, mock window |
| `--bbn-border` | `#232733` | 1px borders |
| `--bbn-text` | `#E8EAF0` | Headings and body |
| `--bbn-muted` | `#9AA1B2` | Secondary text. On `#0B0D12` this pair is about 7:1. |
| `--bbn-accent` | `#FF7A45` | The only accent: logo peak, links, and buttons |
| `--bbn-on-accent` | `#0B0D12` | Text on the accent button. White on `#FF7A45` is too light. |
| `--bbn-success` | `#3DD68C` | Reserved. Not used on the download page. |

Light mode for a later ERP pass can invert paper and text. Do not introduce a second accent.

The ERP app keeps its existing shadcn colors. `app/globals.css` only adds `--bbn-accent`, `--bbn-ink`, and `--bbn-paper` plus matching `--color-bbn-*` theme names. No component was restyled.

## Type

Load these from Google Fonts on the download page only. The ERP app does not load them.

- Headings and UI: IBM Plex Sans Thai
- Latin and numbers: Inter
- Checksums and commands: JetBrains Mono
- Fallback: Noto Sans Thai, Anuphan, Sarabun, then the system UI fonts

Scale: 60/36/22/18/16/14. Line height 1.15 for the hero, 1.6 for body.

## Space, radius, shadow

- Page width 1040px. Section padding 64px, 40px under 800px.
- Gap 16px. Card padding 20px.
- Radius 16px on cards, 12px on the mark, 999px on buttons.
- No drop shadows. Depth is the 1px border only.

## Motion

Hover may brighten a button. `@media (prefers-reduced-motion: reduce)` removes transitions.

## Components

- Sticky nav: logo lockup and one download link.
- Primary button: accent fill, ink text, 44px minimum height.
- OS card: platform, chip, version, exact byte size, full SHA-256, file name.
- Mock window: CSS only, labeled as a mock.
- Trust row: four short statements, no icons from other brands.

## Download page order

1. Nav with the mark and the wordmark BoomBigNose.
2. Hero: full name BoomBigNose ERP Harness AI, Thai subtitle, English line, one button that detects the OS and shows the version and byte size, then our CSS window mock.
3. Trust badges: local only, no cloud AI, AGPL-3.0 with a link to LICENSE, and a data-on-machine line that does not certify PDPA.
4. Module grid of the ERP areas this repo actually ships. No purchasing or stock tile.
5. Three steps.
6. One download card per OS and chip, with the full SHA-256.
7. How to open an unsigned build: SmartScreen, macOS Open Anyway, and the Linux archive.
8. Privacy, including that this page loads Google Fonts and has no analytics.
9. FAQ and system requirements.
10. Footer with the mark and the full product name.

Motion stays in CSS. `prefers-reduced-motion: reduce` turns off the smooth scroll and the button transition.
