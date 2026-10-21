# Product

<!-- impeccable:product-schema 1 -->

Inferred from README.md, HANDOFF.md and the project brief on 2026-10-20; lines marked (inferred) await Alek's confirmation.

## Platform

web

## Users

Curious members of the public, students and teachers who want to see what is happening in the world right now and understand it without an account, a key or specialist training (inferred from the project brief: "open to the public and easy to understand"). A second audience is hobbyist open-source intelligence (OSINT) researchers who use the Intel and Tools sections (inferred).

## Product Purpose

A live 3D globe that puts publicly monitored information (earthquakes, storms, fires, flights, ships, satellites, launches, news, cameras, infrastructure, chemicals, economy) in one place, and explains each layer: what it shows, how it is measured, something to try, and its sources. Success is a visitor who arrives knowing nothing and leaves understanding one real thing about the world today.

## Positioning

Every layer is public data with a lesson and an APA reference attached, so the atlas is a teaching instrument rather than a dashboard of alarms. It runs with no server, no account and no key, as a static site and a desktop app built from the same files.

## Operating Context

Visitors arrive on the website (GitHub Pages), then open the globe app at /app/. Sessions are exploratory: switch layers on, click a feature, read its card, follow a tour or lesson, share a link. The desktop app (Tauri) adds direct fetches and system notifications.

## Capabilities and Constraints

- 65 layers in 11 groups, 210 data sources, 264 references (README, October 2026).
- Plain HTML, CSS and native ES modules; no build step for the app.
- Draw calls stay batched; no overlapping panels (tests/e2e/overlap.py at six window sizes); performance is noticed by the owner.
- Acronyms written out in full on first use.
- Licence AGPL-3.0-only; World Monitor (Elie Habib) and Osiris credits must stay.

## Brand Commitments

Name: Global Intelligence Atlas (GIA). Lineage: grew out of World Monitor, formerly Terra Atlas. Voice: clear, plain, slightly informal, educational. No visual identity is binding (Alek asked for a full redesign on 2026-10-20).

## Evidence on Hand

Real live and bundled datasets, the app itself, site/docs-media screenshots, a promo video built with Remotion (video/). No testimonials, user counts or press exist; none may be invented.

## Product Principles

1. Public by default: only deliberately published sources, never private individuals.
2. Explain, don't alarm: every signal comes with context and a source.
3. Lots of information, never cluttered: clearly separated sections, nothing overlapping.
4. Fast on ordinary hardware.

## Accessibility & Inclusion

Keyboard navigation, readable contrast and reduced-motion support are required (Alek, 2026-10-20). Atkinson Hyperlegible has been the body face since v1 for legibility (inferred reason).
