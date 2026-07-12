# SunScout Product Requirements Document — v2 (Full Scope)

Status: Draft v2 — supersedes v1 social/feed non-goal; incorporates engagement, ranking, advertising, events pillars.  
Prepared: 2026-06-24  
Builds on: [v1 PRD](./PRD.md) and [SunScout Coda document](https://coda.io/d/Sunscout_daBnVxQR44i/Sunscout_suiVTADr#_luCClwvK)

---

## 1. Product Summary

SunScout is a global, beach-centric beach-intelligence platform. It combines live ocean/condition data, personalized discovery, trip planning, booking, and a beach-scoped engagement engine — rankings, ephemeral community sightings, events, and brand sponsorships — all organized around the beach rather than a personal feed.

The product is mobile-first for beachgoers, with responsive B2B web surfaces for merchants and event coordinators. Its commercial model spans booking fees, subscriptions, and brand advertising/sponsorship.

### Product promise

Help a beachgoer answer:

> What is the right beach for me, right now, within a practical drive, with the conditions and amenities I need — and what is actually happening there — and can I book the day before I leave?

### Positioning

- Tagline: The beach app, on the data side.
- Voice: confident, specific, helpful, coastal without beach-pun copy.
- Primary wedge: institutional-grade ocean data in a consumer experience.
- Core differentiation: discovery, real-time conditions, and booking in one product — plus a dynamic, condition-driven ranking that no photo-review or social app can reproduce.

### The unifying principle

SunScout's user content is **beach-scoped, not person-scoped**. The beach is the "account." People do not follow people on SunScout; they follow beaches. This is what prevents SunScout from becoming a worse Instagram and is the foundation of every engagement feature below.

---

## 2. Pillars

1. **Beach Intelligence** — live conditions, tide, crowd, water quality, hazards, Golden Hour, accuracy feedback.
2. **Discovery & Planning** — location-based, vibe/activity-filtered discovery and trip planning with real distances.
3. **Booking & Commerce** — sunbed/umbrella/activity reservations, merchant inventory, settlements.
4. **Engagement Engine** — ephemeral sightings, check-ins, vibe votes, progression/badges.
5. **Dynamic Rankings (Beach Pulse)** — per-audience, dynamic, condition-driven leaderboards.
6. **Beach Events** — beach-centric event calendar; "what's happening" before and during the beach day.
7. **Advertising & Sponsorship** — brand takeovers and contextual surface sponsorship, clearly separated from earned ranking.
8. **Event Coordinator (B2B)** — a planning/publishing surface for coordinators to inform attendees and take over event presence.

---

## 3. Primary Users

### The Beachgoer (Planner / Explorer)

Family or group planner (30–45) and solo traveler/couple (25–35). Needs the right beach right now, live conditions, real distances, group-suitable rankings, authentic current photos, and what's happening.

### The Group

A friends/group unit, not only a family. The product explicitly serves families, friends, solo visitors, couples, party seekers, and beach-club visitors. A group has companions (family/friend/solo) so trips and rankings can be planned for the group.

### The Merchant

Beach-club owner or activity operator. Needs discoverability, live inventory, prepayment, QR redemption, settlements, and promoted placement.

### The Event Coordinator (NEW)

An event organizer running beach parties, surfing competitions, beach soccer, triathlons, sailing events, or full beach takeovers. Needs one place to publish event info to attendees, reach people at or heading to the beach, and optionally purchase a beach/island takeover for the event window.

### The Brand Advertiser (NEW)

A swimwear/bikini brand, sunblock brand, watch brand, beach club, or event sponsor seeking contextual placement and takeovers on beach surfaces.

### The Institutional Buyer

Municipality, tourism board, environmental team. Needs anonymized crowd trends, water-quality records, exports, embeds, and contractual data access.

---

## 4. Product Principles

1. The beach is a data product, not a postcard.
2. The free tier must complete the core discovery loop without requiring a card.
3. Conditions include timestamps and confidence/provenance states; data degrades honestly when delayed.
4. User location is collected only for explicit nearby search, check-in, or sighting capture.
5. Content is beach-scoped, never person-following.
6. **Earned vs paid separation:** live condition data and the Beach Pulse ranking are never for sale. Paid placement and takeovers own the visual/branding/curated-content layer only and are clearly labeled. This separation is the core trust moat.
7. UGC is ephemeral and freshness-weighted; recency is a feature, not a limitation.
8. Every major feature is instrumented against a measurable outcome.

---

## 5. Engagement Engine — Sighting Capture

The lightest-weight UGC that feeds everything downstream. A "sighting" is a piece of beach-scoped content attached to a beach (and optionally to an event), not to a follower graph.

### 5.1 Sighting entity

A sighting captures one of:

- **Native upload** — a photo or short video taken at the beach.
- **Social link** — an attributed TikTok or Instagram post URL (link, not rehosted). Content remains on its origin platform; SunScout shows attribution and a preview that links out. This drives cross-platform traffic both ways without hosting cost.

Each sighting stores: beach id, optional event id, author (optional/pseudonymous), media reference or outbound URL, caption, time-of-day tag, audience tag (who it's for: family/friends/solo/couples/clubs/chill/beach-club), capture timestamp, expiry timestamp, moderation state, and consent flags.

### 5.2 Ephemeral time-to-live (durable decision)

- Native media is hosted for ~7 days only, then expired/removed.
- This is a deliberate design choice, not a limitation: expiry keeps the "is this beach alive right now" signal fresh, limits permanent liability, and means rankings reflect current reality rather than the best beach of years past.
- Link-based sightings may persist longer (they reference external content) but recency-decay in ranking regardless.

### 5.3 Product stance on beach content (durable decision)

- Beach content includes people in swimwear, including on clothing-optional/nudist beaches. This is treated as expected beach behavior. The product embraces beach UGC; it does not restrict it away on prudish grounds.
- Recognizable-people consent and basic safety moderation still apply (see §13). The stance is "embrace, with consent and safety," not "avoid."

### 5.4 Capture flow

- From Beach Detail: "Share a sighting" → capture/upload or paste a social URL → tag time-of-day and audience → optional caption → publish.
- Geofence/capture-time verification where feasible to anchor the sighting to the real beach and time.
- Published sighting appears on the beach's sighting rail and contributes to Beach Pulse recency.

### 5.5 Social handoff (outbound + inbound)

- **Outbound:** Share sheet / deep link to a SunScout beach page, plus a generated "right now conditions" card image creators can post to TikTok/IG, driving their audience back to SunScout for the data.
- **Inbound:** A user attaches their TikTok/IG beach-post URL to a beach as a sighting. Attribution flows back to the creator. SunScout is the data layer that social posts point at and are pointed back from; it does not host a social graph.

---

## 6. Dynamic Rankings — Beach Pulse

A Beach Pulse score powers dynamic, condition-driven rankings. It is the core moat turned into a leaderboard.

### 6.1 Score components

Beach Pulse blends, with weights that change by audience:

- **Live condition data** (already fetched via adapters): crowd density, water quality, wind, wave height/direction, tide, ambient temperature, cloud cover, UV, golden-hour light score.
- **Community signals:** check-ins, vibe votes (`VibeVote`), condition-accuracy ratings (from the Today rework), sighting recency and volume.
- **Freshness:** recency of like-minded visitors (sightings/check-ins from the selected audience) — fresh media from people like you boosts the beach; a beach with no recent sightings decays even if conditions are perfect, because "nobody like you is there right now."

### 6.2 Per-audience weighting (durable decision)

Not one universal leaderboard — the same beaches reshuffled per audience, weighting different signals:

- **Family:** kid-safe water quality, lifeguard presence, shade, parking, accessibility, low hazard, calm water.
- **Friends:** social heat, beach-club availability, activity options, crowd.
- **Solo:** calm water, low crowd, safety, hidden-gem factor.
- **Couples:** golden-hour light, scenery, low crowd, romantic vibe.
- **Party / clubs:** beach-club check-in heat, music/bookability, crowd, nightlife.
- **Chill:** calm water, low crowd, golden-hour light, low noise.
- **Beach-club:** club inventory, booking availability, check-in heat.

### 6.3 Ranking scopes

- **Radius** (default hero): X km around a point — "what's hot within 20 km right now." The most useful and most defensible; makes live conditions matter most.
- **Island:** all beaches on an island (e.g., Mykonos Top 10) — high shareability/cachet.
- **Beach-bar/club cluster:** leaderboard of beach bars/clubs within a scope.
- **Region:** sq km / bounding box (also used by island/region ad takeovers).

### 6.4 Dynamic behavior

- Rankings re-rank as conditions change through the day (hourly or on new condition refresh).
- "Live now" vs "today" vs "this week" vs "season" time windows.
- Sponsored beaches are surfaced and labeled, but ranked in a separate promoted lane; they never displace organic Beach Pulse results.

### 6.5 Top-10 views

- The hero ranking view is **radius-around-me, live now** (decision pending final confirmation — see Open Decisions).
- Island-level and cluster scopes available as alternatives for shareability.

---

## 7. Beach Events

Beach-centric events: parties and competitions (surfing, beach soccer, triathlons, sailing, and similar), plus full beach takeover events. Not all beaches have events; events are optional enrichment.

### 7.1 Event entity

An event has: host beach (or span of beaches), type (party / competition / clinic / takeover), discipline (surf, soccer, triathlon, sailing, etc.), window (date/time), audience (which group it serves), registration/RSVP, live-update channel, sponsor/takeover association, and a coordinator owner.

### 7.2 "What's happening" view

- Per-beach, per-island, per-radius event calendar.
- Answer "what is actually on at this beach this weekend" — the Ballito-in-summer use case: regular events and parties that today are scattered across Instagram, WhatsApp, posters.
- Beach-centric: events surface inside Discovery as a filter/sort and as a per-beach "what's on" section. (Beach-centric placement preferred over a standalone Events tab — see Open Decisions.)

### 7.3 Event highlight animation (durable decision)

- Events are visually flagged with a **cute GIF/sticker animation** to draw attention (e.g., a small animated marker on the beach card and event entries). Lightweight, on-brand, non-intrusive.

### 7.4 Events as engagement ignition

- An event weekend drives sightings, check-ins, and vibe votes → feeds recency into Beach Pulse → boosts discovery for that beach and audience.
- A surf comp boosts the beach for the active/solo audience; a beach party boosts it for the club audience.

### 7.5 Events as crowd-forecast input (integrity-permitted)

- An event is a legitimate, honest input to crowd forecasting: a beach party or competition raises expected crowd.
- This is the only way an event/coordinator may influence quantitative beach data — as a known, truth-based crowd signal. It must never alter water-quality, hazard, or Pulse truth.

### 7.6 Event discovery placement (decision)

- Preferred: beach-centric — events as a Discovery filter and a per-beach "what's on" section, keeping SunScout anchored to beaches and to the data-side identity. A standalone calendar-first Events tab risks pulling SunScout toward a generic event-listing app.

---

## 8. Advertising & Brand Sponsorship

Future monetization via contextual beach-fit advertising and brand takeovers, in addition to booking revenue.

### 8.1 Sponsorship surfaces

- **Beach club / merchant promoted placement** — paid slots in discovery, labeled, ranked separately from organic.
- **Brand takeover** — a brand takes over a single beach, a full island (all beaches on an island), or a region (sq km/bounding box) for a period (e.g., an event weekend sponsored by a clothing or watch brand).
- **Contextual surface sponsorship** — sunblock sponsors the UV/conditions card; swimwear/bikini sponsors the sightings/stories rail; a watch brand sponsors golden hour; a beach club sponsors its beach detail.

### 8.2 Takeover model

A takeover owns the **visual/branding/curated-content layer** of a beach or scope: the hero, the sponsor rail, the "presented by" bar on the leaderboard, event programming for the window.

- Open question (decision pending): **additive** (brand layers onto the real beach; conditions stay visible underneath) vs **replacing** (brand fully owns hero/content for the window; real conditions pushed below). Recommended: additive-first to protect trust. See Open Decisions.

### 8.3 Earned vs paid rule (core moat)

- Paid placement and takeovers never alter the Beach Pulse ranking or live condition data.
- Promoted beaches are clearly labeled "Sponsored" and sit in a separate promoted lane.
- Brands pay for attention and association with the data, not for rank. This protects credibility, which is itself what makes the placement valuable to brands.

---

## 9. Event Coordinator (B2B Surface)

A B2B surface for coordinators to plan, publish, and (optionally) take over event presence.

### 9.1 Coordinator capabilities

- Create and manage events (party/competition/clinic/takeover) on one or more beaches.
- Publish event info, schedule, registration/RSVP, and live updates to attendees.
- Reach beachgoers at or heading to the beach through SunScout's per-beach "what's on" surface.
- Purchase a beach/island takeover for the event window (links into §8 advertising system).
- View engagement analytics for their events (sightings, check-ins, RSVPs, reach).

### 9.2 Coordinator integrity

- The coordinator owns the event presence/branding/schedule only.
- They cannot edit live conditions, water quality, hazards, or the Beach Pulse ranking.
- The event's crowd-forecast influence (§7.5) is a system-applied, truth-based input, not a coordinator marketing lever.

### 9.3 Persona fit

The coordinator is the events-side equivalent of the Merchant persona — a B2B operator who adopts SunScout because it does the hard part (reaching people already at or heading to the beach) and monetizes via takeovers.

---

## 10. Beach Intelligence (Today / Detail) — retained from v1, extended

### 10.1 Today screen

- Large but not feed-dominant beach image.
- Compact suitability rail (families, solo, couples, party seekers, beach-club) that does not compete with live conditions.
- Golden Hour as a single dedicated action row, not a duplicate condition metric.
- Filled detail under "View beach / Find another": cloud cover, ambient temperature, wind factor (already fetched from Open-Meteo, surfaced).
- **Accuracy feedback:** the user can rate each condition/feature for accuracy, feeding Beach Pulse community signals.

### 10.2 Beach Detail

Live-looking conditions with source and freshness, tide, crowd, water quality, amenities, hazards, golden hour, sighting rail, event "what's on" section, and booking entry.

---

## 11. Discovery & Planning — retained from v1, reworked

### 11.1 Discovery rework

- Enter/select a GPS location.
- Rich filter system (much more detailed and spacious than the current chip row): distance, audience, activity, and clothing-optional/nudist as a first-class filter.
- Sort by Beach Pulse and by distance.

### 11.2 Trip planner rework

- Enter/select a GPS location (where staying).
- Lists all beaches in that area with real distances: walking distance + walking time, driving distance + driving time.
- Filter by group vibe (family/friends/clubs/beach clubs/chill/solo) and by activity type (club, water sports, beach park/play, snorkeling, etc.).
- Replaces the flat-list trip selection with a location + vibe/activity-filtered, distance-sorted planner.

### 11.3 Companions / group profile

- Profile supports companions: add/link friends (name + relationship: family/friend/solo).
- A trip/ranking can be planned for the group, not only a family profile.

### 11.4 Mapping adapter

- Distances use the mapping adapter (haversine walk/drive estimates now; swap for Mapbox/OSRM once the mapping provider is licensed — PRD non-goal until then).

---

## 12. Booking & Commerce — retained from v1

- Sunbed, umbrella, and water-activity booking.
- Merchant inventory, prepayment, QR redemption, settlements.
- Reservation flow demonstrated end-to-end with mock data in Release 0.

---

## 13. Content Moderation, Consent & Safety

### 13.1 Moderation

- Native media is subject to safety moderation (illegal content, non-consensual imagery, harassment).
- Ephemeral 7-day TTL limits permanent liability and stale surface area.
- Recognizable people require consent at capture; the capture flow prompts for it.

### 13.2 Clothing-optional / nudist beaches

- First-class discovery filter; content from these beaches is allowed under the same consent/safety rules.

### 13.3 Privacy

- No background location collection; location only for explicit nearby search, check-in, or sighting capture.
- Default sighting/check-in sharing to private where applicable; pseudonymous authoring supported.
- Delete-account flow supports erasure including expired media and link references.

---

## 14. Data Model (additions)

New entities extending the v1 model (Beach, Condition, HazardAlert, Trip, TripBeach, Wishlist, Photo, BadgeAward, etc.):

- **Sighting** — beachId, eventId?, mediaRef | externalUrl, caption, timeOfDayTag, audienceTag, capturedAt, expiresAt, moderationState, consentFlags, authorRef?.
- **Event** — beachIds[], type, discipline?, windowStart, windowEnd, audience, registrationUrl?, coordinatorId, sponsorTakeoverId?, liveChannelId?.
- **BeachPulseScore** — beachId, audience, scope, window, componentScores{}, computedAt.
- **VibeVote** — (existing type retained) tag, votes, userVoted.
- **AccuracyRating** — beachId, feature, rating, userId, at.
- **CheckIn** — (existing) beachId, userId, at, privacy.
- **SponsorCampaign / Takeover** — sponsorId, scope (beach/island/region), surface, window, creativeRef, additive|replacing.
- **Coordinator** — userId, organization, managedEvents[].
- **Companion** — profileId, name, relationship (family/friend/solo).
- **SocialLinkAttribution** — sightingId, platform (tiktok/instagram), externalUrl, creatorHandle.

PostgreSQL remains the system of record; object storage (S3-compatible) for transient media with TTL lifecycle rules enforcing the 7-day expiry.

---

## 15. API Domains (additions to v1)

- Sightings (create, list-by-beach, expire, moderate, attribute-social-link).
- Events (CRUD, calendar-by-beach/island/radius, RSVP, live updates).
- Beach Pulse (compute, read-by-audience/scope/window).
- Rankings (top-N by audience/scope/window; sponsored lane separate).
- Sponsor campaigns / takeovers (create, schedule, scope, creative).
- Coordinator (auth, manage events, analytics, purchase takeover).
- Companions (CRUD on group profile).
- Accuracy ratings (submit, aggregate).

All endpoints require explicit auth/authorization; public endpoints have abuse controls and rate limits. Provider data includes observed time, received time, source, and freshness state.

---

## 16. Build Sequence (recommended ordering)

Sequenced so the consumer engagement loop exists before the B2B and paid layers that depend on it.

1. **Sighting capture** — native uploads (7-day TTL) + social-link attribution; sighting rail on Beach Detail.
2. **Beach Pulse + Top-10** — score components, per-audience weights, radius/island/cluster scopes; leaderboard screens.
3. **Accuracy feedback** — Today condition ratings feeding Pulse.
4. **Events (consumer side)** — beach-centric "what's on" calendar, event filter in Discovery, the cute GIF highlight, crowd-forecast input.
5. **Advertising scaffolding** — labeled promoted lane, contextual surface sponsorship, takeover model (additive-first).
6. **Event Coordinator B2B surface** — event management, publishing, RSVP, analytics, takeover purchase.
7. **Full paid takeover system** — island/region takeovers, additive→replacing modes, sponsor self-serve (later).

---

## 17. Analytics & Success Metrics (additions)

- **Activation:** new signup completes Smart Discovery + views Beach Detail within 7 days (v1: 50%→60%→65%).
- **Engagement:** sightings per active beach per week; % of beachgoers posting at least one sighting.
- **Ranking interaction:** Top-10 views per session; scope/audience switches.
- **Event performance:** events published per beach; RSVP→check-in conversion; event-driven sighting spike lift.
- **Monetization:** sponsor/takeover fill rate; ARPU including ad/sponsorship revenue (v1 ARPU $0.40→$0.55→$0.70, now blended with ads).
- **Trust signal:** share of users who interact with a sponsored beach but still view organic ranking; accuracy-rating submission rate.

### New Release-0 events

- `sighting_published` (with type: upload | social_link)
- `ranking_viewed` (with scope, audience, window)
- `event_viewed`
- `accuracy_rating_submitted`
- `sponsor_impression` / `sponsor_clicked`
- `takeover_viewed`

---

## 18. Quality Requirements (additions)

- All §15/§16 v1 quality targets retained (320px usability, WCAG AA, freshness states, p95 targets).
- Media TTL lifecycle enforced server-side; no native media served past 7 days.
- Sponsored content visually distinct from organic ranking at a glance (clear "Sponsored" labeling).
- Event GIF/sticker animation must not impede readability or performance (Lighthouse budget preserved).

---

## 19. Open Decisions (need confirmation)

1. **Hero ranking scope** — radius-around-me live now (recommended) vs island-level Top-10 as hero for shareability. Default: radius live-now.
2. **Events placement** — beach-centric filter + per-beach section (recommended) vs standalone Events tab. Default: beach-centric.
3. **Takeover mode** — additive (recommended, trust-preserving) vs replacing. Default: additive-first.
4. **Sighting authorship** — pseudonymous vs profile-linked-by-default. Default: pseudonymous, opt-in profile attribution.
5. **Social-link sighting persistence** — link sightings persist beyond 7 days but decay in ranking; confirm decay window.

---

## 20. Non-Goals (updated)

v1 non-goals retained, with this change:

- **"Social following/feed" non-goal is retired/redefined.** The social surface is now explicitly beach-scoped and ephemeral (sightings, events, takeovers) — never person-following, never a personal feed. This is the deliberate scope expansion captured across our conversations.

Retained non-goals:

- Surf forecasting beyond basic wave height/direction.
- Hotel/vacation-rental booking; restaurant reservations.
- Voice notes; full merchandise commerce.
- Full B2B contract administration.
- Production SoFar, Stripe Connect, mapping, water-quality, tide integrations before commercial access is secured.
