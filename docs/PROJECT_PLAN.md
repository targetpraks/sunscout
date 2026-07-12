# SunScout Execution Plan

Status: Active  
Start date: 2026-06-21  
Primary target: private-beta-ready product foundation

## Delivery Strategy

Build SunScout as vertical slices that can be used and tested end to end. The first slice is a polished local product using realistic seed data and adapter interfaces. External services are attached only after the interaction model and information architecture are validated.

## Phase 0 — Product and Design Lock

Target: immediate

- [x] Read the complete Coda document structure.
- [x] Extract narrative pages, feature inventory, user stories, acceptance criteria, open questions, release tasks, pricing, personas, and brand rules.
- [x] Produce the consolidated PRD.
- [x] Produce this execution plan.
- [x] Generate three visual directions for the mobile consumer core.
- [x] Select and lock one direction (design/concepts/05-tide-atlas-final.png).
- [x] Create the component and token inventory from the selected direction.

Exit criteria:

- Product brief and visual target are unambiguous.
- First-slice scope is fixed.
- No unresolved visual decisions block implementation.

## Phase 1 — Interactive Consumer Core

Target: first executable slice

### Foundation

- [x] Initialize React, TypeScript, and Vite.
- [x] Add linting, formatting, type checks, and tests. (typecheck + vitest + smoke + Prettier in place; CI workflow added)
- [x] Add routing, local state, seed-data layer, and provider adapters.
- [x] Implement brand tokens, typography, icon system, responsive shell, and accessibility primitives.

### Screens

- [x] Today / Home.
- [x] Smart Discovery.
- [x] Beach Detail.
- [x] Tide Intelligence detail (embedded in Today + Beach Detail; per-beach tide chart, lowest daytime tide, beach-width estimate).
- [x] Golden Hour detail (dedicated GoldenHourDetail screen with compass, sunrise/sunset/blue-hour, light score, alert).
- [x] Wishlist / saved beaches.
- [x] Trip state.
- [x] Check-In success flow.
- [x] Reservation selection, review, confirmation, and QR state (signed expiring QR token).

### Product behavior

- [x] Natural-language query parser with deterministic local fallback.
- [x] Structured filters.
- [x] Match score and ranking.
- [x] Save/unsave (with 50-beach free-tier cap).
- [x] Create/update one trip (with one-active-trip free-tier cap).
- [x] Simulated location and check-in.
- [x] Simulated inventory and booking.
- [x] Local persistence.
- [x] Local analytics adapter (all 11 Release-0 events wired).

### Verification

- [x] Desktop and mobile browser checks (headless Chrome: 320px + 1280px no-clipping verified; Lighthouse a11y 100, perf ~77 localhost).
- [x] Keyboard and screen-reader basics (semantic buttons, aria-labels, focus-visible, role=status).
- [x] Reduced-motion behavior (chart animations + compass respect prefers-reduced-motion).
- [x] Unit tests for ranking, pricing, persistence, and entitlement rules (vitest: src/logic.test.ts + server/tokens.test.ts, 14 tests).
- [x] End-to-end test for discover → detail → save → book (server/scripts/smoke.ts).

Exit criteria:

- The core loop is usable without a backend.
- The UI faithfully matches the selected concept.
- All primary interactions update real local state.

## Phase 2 — Backend and Accounts

Target: private-beta infrastructure

- [x] Establish workspace architecture for consumer, merchant, and API packages.
- [x] Implement PostgreSQL schema and migrations (001–003).
- [x] Add authentication and user profile (JWT/JWKS adapter boundary wired; dev header fallback; Clerk account pending).
- [x] Implement beaches, conditions, discovery, trips, wishlists, check-ins, bookings, and merchants.
- [x] Add role and tenant authorization (merchant owner scoping + institution member/contract isolation).
- [x] Add signed upload and QR token services (HMAC-signed expiring booking tokens; redeem verifies signature + expiry).
- [x] Add audit events (audit_log on booking/redeem/inventory/premium/vote/ingest/cancel/claim/hazard). (rate limits, idempotency keys, background jobs pending)
- [x] Add provider interfaces for weather, tide, mapping, water quality, and SoFar (Open-Meteo live + mocked fallbacks for the rest).
- [x] Add Sentry and product analytics (analytics_event table + local adapter; ops/status endpoint; Sentry DSN adapter pending).
- [x] Add CI, preview environments, secrets handling, and backups (GitHub Actions CI workflow + .env.example adapter flags; preview envs/backups pending).

Exit criteria:

- A signed-in user can perform the consumer core loop against the API.
- Test data can be ingested and refreshed.
- Security boundaries are tested.

## Phase 3 — Merchant Marketplace

- [x] Merchant onboarding and beach claim (claim endpoint + merchant_claim table + Profile claim flow).
- [x] Inventory management (live inventory + optimistic version locking).
- [x] Booking availability and locking (FOR UPDATE inventory lock inside transaction).
- [x] Stripe test-mode checkout (payments adapter boundary; simulated fallback; Stripe keys pending — PRD non-goal until commercial access).
- [x] Stripe Connect onboarding and settlement ledger (settlement ledger + commission split; Stripe Connect KYC flow pending).
- [x] QR redemption (signed QR token redeem, merchant dashboard).
- [x] Cancellation/refund workflow (cancel endpoint + full/50%/none refund math, unit-tested, inventory restored).
- [x] Merchant dashboard (today/upcoming bookings, inventory, settlements, redeem).
- [x] Booking and payment reconciliation (settlement row per booking; net = gross − commission).

Exit criteria:

- A test merchant can list inventory.
- A consumer can pay in test mode.
- The merchant can redeem the booking.
- Settlement math is reproducible.

## Phase 4 — Data and Engagement

- [x] Real provider integrations (Open-Meteo live; mocked fallback adapters for the rest).
- [x] Spotter ingestion adapter and freshness rules (SoFar adapter + freshness labels; mocked until data rights).
- [x] Crowd aggregation (crowd_density table + check-in crowd contribution).
- [x] Hazard reporting and verification (community hazard report endpoint + UI; verified flag for review).
- [x] Photo check-in (photo_url + caption on check-in).
- [x] Badges and progression (badge/badge_award, check-in milestone awards, profile display).
- [x] Push notifications (notification + preference + push_subscription tables, VAPID adapter boundary; push provider keys pending).
- [x] Calendar export (one-way .ics export of bookings).
- [x] Offline trip pack (Premium downloadable JSON snapshot).
- [x] Family, accessibility, pet, and solo filters (Discovery filters).

Exit criteria:

- Pilot beaches show reliable sourced conditions.
- Check-ins improve crowd estimates.
- Alerts and offline states are trustworthy.

## Phase 5 — Institutional Product

- [x] Municipal dashboard (institutional portfolio screen).
- [x] Beach status portfolio (crowd, water quality, hazard count, freshness per pinned beach).
- [x] Crowd and water-quality trends (30-day trends endpoint over condition history; TimescaleDB deferred).
- [x] CSV and GeoJSON export (contract-tracked export usage).
- [x] iframe status embed (signed public embed_token endpoint, snippet provided).
- [x] Contract entitlements and usage limits (institution_contract with active/expired/terminated + export quota).
- [x] Region-pinned data configuration (institution_beach pinning).
- [x] Operational SLA dashboard (ops/status endpoint: uptime, config flags, beach/hazard counts).

Exit criteria:

- Three pilot tenants can be provisioned safely.
- Data exports and embeds are auditable and privacy-preserving.

## Prioritized Product Backlog

### P0 — Build first

1. Beach Quality Metrics
2. Vibe Categorization
3. Smart Discovery
4. Distance and Logistics
5. Golden Hour and Lighting
6. Tide Intelligence and Beach Width
7. Hyper-local Weather
8. Water Quality
9. Vibe Photo Gallery
10. Wishlist and Crowd Forecast
11. Reservation System
12. Merchant Profile and Live Inventory
13. Prepayment Policy
14. Beach Check-In
15. Badges foundation
16. Hazard Alerts
17. SoFar provider adapter

P0 items from later commercial pillars—eco merchandise and full B2B data—remain in the product backlog but do not block the consumer beta.

### P1 — After the core loop

1. Age-aware family discovery
2. Solo filter
3. Accessibility filter
4. Pet rules
5. Multi-beach trip planner
6. Activities and bundles
7. Merchant QR tablet/PWA
8. Photo check-in
9. Spotter crowdfunding program

### P2 — Later

1. Attribution depth
2. Pricing history
3. Social following and feed
4. ML hazard clustering
5. Sustainability stories
6. Real-estate licensing
7. Public municipal board
8. Resale-ready data feeds

## First 10 Implementation Tickets

### SS-001 Project foundation

Create the app, TypeScript configuration, routing, styles, tests, and quality scripts.

Done when:

- Development server starts.
- Type check, lint, tests, and production build pass.
- App shell loads at mobile and desktop widths.

### SS-002 Design tokens and primitives

Implement colors, typography, spacing, radii, elevations, buttons, inputs, tabs, chips, meters, and feedback states.

Done when:

- Components follow the locked visual target.
- Focus, hover, selected, disabled, loading, and error states exist.

### SS-003 Seed beach domain

Create typed seed data for beaches, conditions, tides, Golden Hour, amenities, vibes, hazards, photos, merchants, and inventory.

Done when:

- At least six beaches have complete, varied data.
- Every provider value includes source and freshness metadata.

### SS-004 Today screen

Build home-beach conditions, Golden Hour countdown, alerts, booking/trip preview, and core actions.

### SS-005 Smart Discovery

Build query input, filters, deterministic query interpretation, ranking, and result list.

Done when:

- The search output changes meaningfully with filters.
- Result cards expose match score, logistics, crowd, and key conditions.

### SS-006 Beach Detail

Build the complete detail surface with conditions, tide preview, Golden Hour, water quality, amenities, vibes, hazards, gallery, and inventory.

### SS-007 Save and Trip state

Implement wishlist persistence and one active trip.

### SS-008 Check-In

Implement explicit simulated location verification, privacy copy, success state, and points.

### SS-009 Reservation

Implement item selection, time slot, order summary, cancellation terms, simulated payment, confirmation, and QR state.

### SS-010 Verification

Add unit and end-to-end coverage and complete mobile/desktop visual QA.

## Technical Workstreams

### Product application

- Mobile-first responsive consumer experience.
- Merchant and B2B packages introduced when those phases begin.

### Data contracts

- Provider-neutral beach condition schema.
- Freshness and fallback states.
- Stable event names and analytics properties.

### Platform

- Auth, database, API, storage, payments, queueing, and observability.

### Trust

- Privacy, location minimization, tenant isolation, payment integrity, audit logs, and data licensing boundaries.

## Risks and Mitigations

### External data rights

Risk: SoFar, Blue Flag, tide, or water-quality access is delayed.

Mitigation: provider adapters, explicit provenance, realistic mock data, and no unsupported verification claims.

### Scope inflation

Risk: 40 features across four product surfaces delay the core loop.

Mitigation: consumer vertical slice first; merchant, engagement, and B2B follow behind clear exits.

### Premature architecture

Risk: multiple databases, services, regions, and observability vendors add cost before product validation.

Mitigation: modular monolith, PostgreSQL-first, measured expansion.

### Marketplace complexity

Risk: KYC, refunds, inventory races, and country rules.

Mitigation: Stripe test mode, idempotent booking state machine, inventory locks, pilot-country matrix.

### Privacy

Risk: location, child profile, check-in, photo, and B2B aggregation data create trust and regulatory exposure.

Mitigation: explicit collection, private defaults, minimization, deletion, aggregation thresholds, and legal review.

## Decision Log

- Consumer core is built before merchant and B2B dashboards.
- Web prototype validates the core loop before committing the same UI to native.
- PostgreSQL is the initial system of record.
- Additional databases are deferred until justified.
- External providers are accessed through adapters.
- B2B embed defaults to iframe.
- One-way calendar export is v1.
- Social feed is not part of the beta.
- No background location collection.

