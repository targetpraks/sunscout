# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## SunScout Design Decisions

- Approved source visual: `design/concepts/05-tide-atlas-final.png`.
- The product is mobile-first and data-rich, with a large but not feed-dominant beach image.
- The Today screen explicitly shows suitability for families, solo visitors, couples, party seekers, and beach-club visitors.
- The suitability rail stays compact so it does not compete with live conditions.
- Golden Hour appears once as a dedicated action row, not as a duplicate condition metric.
- Brand palette: Sand Beige `#FAF6F0`, Ocean Teal `#0A6E78`, Sunset Coral `#FF6B5C`, Deep Marine `#0F1E2E`, Sea Glass Green `#2E8B6B`.

## Trip Planner + Discovery + Today Extension (user direction, 2026-06-22)

The product is for friends/groups, not only families. Durable requirements to implement:

- Profile — companions: add/link friends (name + relationship: family/friend/solo) so a trip can be planned for a group, not only a family profile.
- Trip planner rework: when creating a trip the user enters/selects a GPS location (where they are staying); the planner lists all beaches in that area with real distances — walking distance + walking time, driving distance + driving time. Beaches are filtered by what the group feels like doing (family / friends / clubs / beach clubs / chill / solo) and by activity type (club, water sports, beach park / play, snorkeling, etc.). The current "select beaches from a flat list" trip flow is replaced by a location + vibe/activity-filtered, distance-sorted planner.
- Discovery rework: same location + rich filter system — enter a GPS location and filter beaches by distance, audience, activity, and clothing-optional/nudist. The filter UI must be much more detailed with more options and more space (the current chip row is too weak).
- Today rework: fill the white space under "View beach / Find another" with more detail — cloud cover, ambient temperature, wind factor (already fetched from Open-Meteo, surface them), and let the user rate each condition/feature for accuracy (accuracy feedback).
- Nudist / clothing-optional beaches: a first-class filter in discovery so users can discover clothing-optional beaches.
- Distances use the mapping adapter (haversine walk/drive estimates now; swap for Mapbox/OSRM once the mapping provider is licensed — PRD non-goal until then).

## Beach Engagement + Dynamic Rankings (user direction, 2026-06-24)

A beach-scoped engagement system, kept beach-focused (content is organized around the beach, not a personal feed). The app is global in ambition. Durable decisions:

- User-generated media (photos + video) of the beach / of people at the beach is a first-class part of the product. Native uploads are accepted; the app does not avoid this on moderation grounds — it is treated as expected beach behavior. Recognizable-people consent and basic safety moderation still apply, but the product stance is to embrace beach UGC, not restrict it away.
- Media is ephemeral, not hosted forever: ~7-day time-to-live. Expiry is a feature — it keeps the signal "is this beach alive right now" fresh and limits permanent liability.
- Beach bars / clubs are a first-class engagement surface (merchant-scoped leaderboards tied to check-in heat + booking demand).
- Rankings must be dynamic and ever-changing, not static all-time lists. They re-rank from live conditions + community signals.
- Rankings must serve different groups' wants — not one universal leaderboard, but per-audience leaderboards (family / friends / solo / couples / clubs / chill / beach-club) that reweight the Beach Pulse score by what that group cares about.
- Ranking scopes: by island, by radius (X km from a point), and by beach-bar cluster.
- Social handoff is a complement, not the core: share cards / deep links out (creators point audiences to SunScout for live data) + inbound attribution of TikTok/IG post URLs to a beach (link, not rehost). SunScout does not host a social graph.
- This is a deliberate expansion of PRD v1's "no social following/feed" non-goal: the social surface is beach-scoped and ephemeral, never person-following.

## Advertising + Brand Sponsorship (user direction, 2026-06-24)

Future monetization via advertising and brand sponsorships, not only booking. Beach-themed and brand-fit advertising is welcome. Durable decisions:

- Paid placement surfaces: a beach club, bikini/swimwear brand, sunblock brand, etc. can pay for placement.
- Brand "takeovers": a brand can take over a single beach, a full island (all beaches on an island), or a region (sq km / bounding box) for a period — e.g. an event weekend sponsored by a clothing or watch brand.
- Sponsorship can be contextual to the surface (sunblock sponsors UV/conditions; swimwear sponsors sightings/stories; watch brand sponsors golden hour; beach club sponsors its beach detail).
- Integrity rule (to protect the "data side" trust moat): paid placement and takeovers own the visual/branding/curated-content layer only. They must never alter the Beach Pulse ranking or live condition data. Promoted beaches are clearly labeled as sponsored and ranked separately from organic results. Brands pay for attention and association with the data, not for rank.

## Beach Events + Event Coordinator (user direction, 2026-06-24)

Beach events are a first-class surface, not all beaches have them. Durable decisions:

- Event types include beach parties and competitions: surfing, beach soccer, triathlons, sailing, and similar. Full beach takeover events also exist.
- SunScout serves as a "what's actually happening" view — per-beach, per-island, per-radius event calendar (e.g. Ballito, South Africa in summer hosts regular events/parties; users should see what is really on at a beach, before and during).
- An Event Coordinator is a B2B role: coordinators use a dedicated event-planning section to publish event info to their clients/attendees, and can purchase a beach/island takeover for the event window. The coordinator effectively takes over the event presence on the beach to inform attendees.
- Events plug into the engagement engine: an event weekend drives sightings, check-ins, and vibe votes, which feed recency into the Beach Pulse and boost discovery for that beach.
- Events are a known input to crowd forecasting (a beach party or competition legitimately raises expected crowd).
- Integrity rule carries over: events and event takeovers own the curated/visual/branding layer; live condition data and the Beach Pulse ranking remain truthful and not editable by the coordinator. The event can change the crowd forecast, never the water-quality or hazard truth.
