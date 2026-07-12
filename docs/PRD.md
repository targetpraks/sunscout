# SunScout Product Requirements Document

Status: Build-ready v1  
Source of truth: [SunScout Coda document](https://coda.io/d/Sunscout_daBnVxQR44i/Sunscout_suiVTADr#_luCClwvK)  
Prepared: 2026-06-21

## 1. Product Summary

SunScout is a global beach-intelligence platform that combines:

1. Personalized beach discovery.
2. Live beach conditions and shore-accurate ocean data.
3. Trip planning and saved beaches.
4. Sunbed, umbrella, and water-activity booking.
5. GPS check-ins, community signals, and progression.
6. Merchant inventory and operations.
7. Municipal and institutional data products.

The initial product is mobile-first for beachgoers. Merchant and B2B workflows are responsive web applications.

### Product promise

Help a beachgoer answer:

> What is the right beach for me, right now, within a practical drive, with the conditions and amenities I need—and can I book the day before I leave?

### Positioning

- Tagline: The beach app, on the data side.
- Voice: confident, specific, helpful, coastal without beach-pun copy.
- Primary wedge: institutional-grade ocean data in a consumer experience.
- Core differentiation: discovery, real-time conditions, and booking in one product.

## 2. Problem

A beach day is a high-effort leisure decision assembled from fragmented tools:

- Tripadvisor for old reviews.
- Google Maps for routes and parking.
- Generic weather apps for broad forecasts.
- Instagram for visually attractive but stale photos.
- Surf apps designed for surfers rather than the wider beach-going audience.
- On-site guessing for live crowd levels and amenity inventory.

The user risks losing hours to a beach that is crowded, unsafe, poorly suited to their group, or missing the inventory they expected.

## 3. Goals and Non-Goals

### v1 goals

- Let users discover suitable beaches through natural-language and structured filters.
- Show a credible, useful Beach Detail view with conditions, tide, crowd, water quality, amenities, hazards, and Golden Hour.
- Let users save beaches and maintain one active trip on the free tier.
- Support beach check-in with privacy-preserving location handling.
- Demonstrate bookable amenity inventory and a complete reservation flow.
- Establish event instrumentation for activation and retention metrics.
- Provide a mockable adapter boundary for external data providers.

### v1 non-goals

- Surf forecasting beyond basic wave height and direction.
- Hotel or vacation-rental booking.
- Restaurant reservations.
- Voice notes.
- Full B2B contract administration.
- Production SoFar, Stripe Connect, mapping, water-quality, or tide integrations before commercial access is secured.
- Social following/feed.
- Full merchandise commerce.

## 4. Primary Users

### The Planner

Family or group planner, typically 30–45. Needs kid-safe conditions, parking, lifeguards, shade, accessibility, advance booking, and confidence before packing the car.

### The Explorer

Solo traveler or couple, typically 25–35. Needs hidden gems, current crowd levels, safety alerts, Golden Hour direction, authentic photos, and saved places.

### The Merchant

Beach-club owner or activity operator. Needs discoverability, live inventory, prepayment, QR redemption, settlements, and basic channel attribution.

### The Institutional Buyer

Municipality, tourism board, environmental team, or real-estate operator. Needs anonymized crowd trends, water-quality records, exports, embeds, and contractual data access.

## 5. Product Principles

1. The beach is a data product, not a postcard.
2. The free tier must complete the core discovery loop without requiring a card.
3. Conditions must include timestamps and confidence/provenance states.
4. User location is collected only for explicit nearby search or check-in.
5. Merchant UX is a first-class product, not an administrative afterthought.
6. Real-time claims must degrade honestly when data is delayed or unavailable.
7. Every major feature must be instrumented against a measurable outcome.

## 6. Scope and Release Strategy

### Release 0: Interactive product foundation

Purpose: validate information architecture, product language, visual system, and core loop.

- App shell and responsive design tokens.
- Today/Home.
- Smart Discovery.
- Beach Detail.
- Tide Intelligence.
- Golden Hour.
- Wishlist and one active Trip.
- Check-In state.
- Reservation flow and QR confirmation using mock data.
- Local persistence.
- Analytics event contract.

### Release 1: Private beta platform

- Authentication and user profile.
- Production relational data model.
- Admin beach ingestion.
- Real weather/tide provider adapters.
- SoFar adapter with mocked fallback until access is approved.
- Check-in API and privacy controls.
- Merchant profile, inventory, and booking management.
- Stripe test-mode checkout and Connect onboarding.
- Push-notification foundations.
- Error tracking, product analytics, and feature flags.

### Release 2: Marketplace and engagement

- Merchant tablet/PWA and QR redemption.
- Activities and bundles.
- Calendar sync.
- Photo check-in.
- Badges and progression.
- Family, accessibility, pet, and solo filters.
- Offline trip pack.
- Water-quality alerts and hazard verification.

### Release 3: Institutional intelligence

- Municipal dashboard.
- Crowd and water-quality time series.
- Export and embed surfaces.
- Contract and usage controls.
- Data residency and retention policies.
- SLA monitoring.

## 7. Core Consumer Journey

1. User opens Today and sees nearby or selected home-beach conditions.
2. User describes the desired beach in natural language or applies filters.
3. SunScout returns ranked matches with a score, drive time, crowd, sea temperature, and Golden Hour.
4. User opens Beach Detail and reviews conditions, tide, water quality, hazards, amenities, photos, and merchant inventory.
5. User saves the beach, adds it to a trip, checks in when nearby, or books inventory.
6. Booking produces a confirmation and offline-readable QR code.
7. Check-in contributes an anonymized crowd signal and progression points.

## 8. Functional Requirements

### 8.1 Today / Home

- Show home or nearby beach.
- Show weather, UV, sea temperature, wave height, crowd state, water quality, and freshness timestamp.
- Show Golden Hour countdown.
- Show upcoming booking or trip.
- Show active hazard or water-quality alerts.
- Offer direct actions for Discover, View beach, and Check in.

### 8.2 Smart Discovery

- Accept natural-language input.
- Support structured filters for vibe, sand, lifeguard, parking, distance, crowd, accessibility, pets, family, and hidden gems.
- Return ranked beach matches.
- Show free-tier result limit and clear premium boundary without blocking the first useful results.
- Target search response: under 1.2 seconds p95 once production backend is implemented.
- Each result shows match score, distance/drive, crowd, key conditions, Golden Hour, and save state.

### 8.3 Beach Detail

- Hero photo and beach identity.
- Current condition strip with source/freshness.
- Crowd state and forecast.
- Tide chart and Beach Width estimate.
- Golden Hour timing and direction.
- Water-quality and Blue Flag state.
- Amenities with verification state and last-verified date.
- Vibe tags with voting state.
- Recent hazard alerts.
- Time-of-day photo gallery.
- Merchant inventory and reservation CTA.
- Save, trip, share, and check-in actions.

### 8.4 Tide Intelligence

- 24-hour tide chart.
- Highlight lowest usable daytime tide.
- Estimate available dry beach width.
- Explain source precision.
- Label stale or unavailable data.

### 8.5 Golden Hour

- Sunrise, sunset, Golden Hour, and blue-hour times.
- Directional compass.
- Six-hour light score.
- Save alert preference.
- Respect reduced-motion settings.

### 8.6 Wishlist and Trips

- Free tier: at least one wishlist, up to 50 saved beaches, one active trip.
- Trip includes name, dates, and candidate beaches.
- Show conditions snapshot per candidate.
- Persist locally in Release 0 and to the backend in Release 1.

### 8.7 Check-In

- User explicitly initiates check-in.
- Verify user is within the configured beach radius.
- Never collect background location.
- Show successful check-in, progression points, and contribution explanation.
- Make animation optional under reduced-motion settings.

### 8.8 Reservation

- Select date, time, and inventory.
- Display merchant, availability, price, fees, cancellation terms, and total.
- Support test payment state in Release 0 and Stripe test mode in Release 1.
- Produce confirmation and QR code.
- Store booking under My Trips.
- Cancellation: free until 24 hours before; 50% refund inside 24 hours, subject to final legal review.

### 8.9 Merchant

- Claim/create merchant profile.
- Add inventory type, count, price, and slot duration.
- View today and upcoming bookings.
- Redeem QR booking.
- View weekly GMV, settlement, inventory, and simple attribution.

### 8.10 B2B

- Show portfolio of beaches with current status.
- Provide crowd and water-quality history.
- Support CSV/GeoJSON exports.
- Provide iframe-based public status board in the first version.
- Enforce tenant, contract, region, and usage boundaries.

## 9. Free and Paid Entitlements

### Free

- Smart Discovery with at least 3 results.
- Basic weather and tide.
- Beach Detail.
- Check-in.
- Up to 50 saved beaches.
- One active trip.
- Basic reservation and booking history.
- No credit card required.

### Premium — $1.99/month, subject to pricing validation

- Full discovery results.
- 14-day forecast.
- Golden Hour alerts.
- Offline trip packs.
- Unlimited trips and wishlists.
- Ad-free experience.
- Premium family/profile depth.

### B2B Data

- Quote-based annual contracts from $10K–$200K.
- Dashboard, API, exports, embeds, compliance reporting, and Spotter-grade data where available.

## 10. Design Requirements

### Brand tokens

- Ocean Teal: `#0A6E78`
- Sunset Coral: `#FF6B5C`
- Sand Beige: `#FAF6F0`
- White: `#FFFFFF`
- Deep Marine: `#0F1E2E`
- Driftwood: `#5A6B7A`
- Sea Glass Green: `#2E8B6B`
- Saffron: `#E8A33D`
- Error Coral: `#D94F4F`

### Typography

- Inter Display 700 for display.
- Inter 400/500/600 for content and UI chrome.
- Mobile-first scale derived from 12, 14, 16, 18, 20, 24, 32, 40, 56.

### Experience

- Coastal-modern, data-rich, calm, and specific.
- Avoid beach puns, generic travel copy, decorative data, and excessive cards.
- Use Lucide for product icons.
- WCAG 2.1 AA.
- Visible focus states.
- Keyboard support on web.
- Screen-reader labels for icon-only controls.
- Respect `prefers-reduced-motion`.

## 11. Data Model

Initial relational domains:

- User
- Beach
- VibeTag
- VibeVote
- BeachCheckIn
- CrowdDensity
- SpotterReading
- Merchant
- AmenityInventory
- Booking
- Settlement
- Activity
- HazardAlert
- Trip
- TripBeach
- Wishlist
- Photo
- BadgeAward

PostgreSQL should be the system of record. Time-series extensions are introduced when production Spotter volume requires them. JSONB covers flexible metadata before a separate document database is justified.

## 12. API Domains

- Users and entitlements.
- Beaches and live conditions.
- Discovery and ranking.
- Trips and wishlists.
- Check-ins and photos.
- Bookings and QR redemption.
- Merchants, inventory, and settlements.
- B2B contracts, analytics, exports, and embeds.
- Provider ingestion and webhooks.
- Real-time condition, inventory, crowd, and hazard channels.

All endpoints require explicit authentication and authorization rules in the implementation specification. Public endpoints must have abuse controls and rate limits.

## 13. Technical Direction

### Recommended build sequence

- Consumer mobile/web prototype: React + TypeScript with a responsive mobile shell.
- Production mobile: Expo/React Native after core interaction validation.
- Web merchant/B2B: Next.js.
- API: Node.js with a modular service boundary.
- ML/data services: Python only where needed.
- Primary database: PostgreSQL.
- Cache/queues: Redis when server workflows require them.
- Object storage: S3-compatible.
- Payments: Stripe Billing and Connect.
- Observability: Sentry plus product analytics.

### Architecture simplification

The source document proposes PostgreSQL, TimescaleDB, MongoDB, Redis, Node, Python, multi-region AWS, and several observability vendors from day one. v1 should begin as a modular monolith with PostgreSQL and provider adapters. Additional databases, services, regions, and vendors are added only when measured load, compliance, or organizational ownership requires them.

## 14. Analytics and Success Metrics

### Activation

Definition: new signup completes Smart Discovery and views at least one Beach Detail within seven days.

- Q4 2026 target: 50%.
- Q2 2027 target: 60%.
- Year 3 target: 65%.

### D30 retention

Definition: signup is active on day 30 through an app open plus Beach Detail view or Check-In.

- Q4 2026 target: 30%.
- Q2 2027 target: 40%.
- Year 3 target: 45%.

### ARPU

Definition: subscription, marketplace, and data revenue divided by monthly active users.

- Q4 2026 target: $0.40.
- Year 2 target: $0.55.
- Year 3 target: $0.70.

### Required Release 0 events

- `app_opened`
- `discovery_started`
- `discovery_completed`
- `discovery_result_opened`
- `beach_saved`
- `trip_created`
- `check_in_started`
- `check_in_completed`
- `booking_started`
- `booking_completed`
- `premium_viewed`

## 15. Quality Requirements

- Core screens usable at 320 px width.
- WCAG 2.1 AA for web surfaces.
- No clipped primary content at common phone dimensions.
- Release 0 Lighthouse targets: performance 85+, accessibility 95+ on representative web build.
- Production API target: p95 reads under 500 ms excluding third-party latency.
- Smart Discovery target: p95 under 1.2 seconds.
- Crash-free sessions target: 99.5%+.
- All provider data includes observed time, received time, source, and freshness state.

## 16. Privacy and Security Requirements

- No background location collection.
- Location only for explicit nearby search or check-in.
- Minimize child data; store age bands or ages without names.
- Default social/check-in sharing to private.
- Delete-account flow supports data erasure.
- Booking and payment state is verified server-side.
- Signed, expiring QR tokens.
- Tenant isolation for merchant and B2B data.
- Audit log for privileged actions.
- Data retention schedule before beta.
- Incident runbook aligned to GDPR timelines.

## 17. Dependencies and Open Decisions

Critical dependencies:

- SoFar Ocean commercial and technical terms.
- Pilot beach list and data access.
- Mapping and travel-time provider.
- Tide and water-quality provider licensing.
- Stripe Connect country coverage and KYC.
- Blue Flag data rights.
- Brand source files and final mark.

Default product decisions for execution:

- Mapbox-style maps with a travel-time abstraction.
- iframe embed for B2B v1.
- stale Spotter data visible with timestamp; unavailable after 24 hours.
- one-way calendar export.
- public trip links deferred.
- no production claim of Spotter verification until real data rights exist.

## 18. Acceptance Criteria for the First Vertical Slice

- Today, Discovery, and Beach Detail are connected through working navigation.
- Discovery accepts natural-language text and structured filters.
- At least six realistic beaches are seeded.
- Ranking updates when filters change.
- Beach Detail includes live-looking conditions with source and freshness.
- User can save/unsave a beach.
- User can create or update one trip.
- User can complete a simulated check-in.
- User can complete a simulated reservation and view a QR confirmation.
- State survives refresh locally.
- Mobile and desktop layouts remain usable.
- Core analytics events are emitted to a local event adapter.

