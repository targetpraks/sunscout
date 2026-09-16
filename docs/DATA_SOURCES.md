# SunScout — Free Public Data Sources

> Candidate free public live-data feeds for SunScout's provider layer, captured 2026-09-15 from a public X thread ([@mertmetindev](https://x.com/mertmetindev/status/2099430384706396320), 14 Sep 2026) and link-verified. Prefer these free feeds — behind the existing provider-adapter pattern, with `source` and `freshness` metadata — for pilot data before pursuing paid licences.

## Priority feeds

| Feed | Use in SunScout | Coverage | Link |
|---|---|---|---|
| EMSC seismic (FDSN JSON) | Earthquake context + coastal hazard signals; API verified 2026-09-15 | Euro-Mediterranean + global | https://emsc-csem.org |
| Tsunami.gov | Tsunami warning feed (Atom); verified responding | Pacific + global monitoring | https://tsunami.gov |
| SunCalc | Golden-hour / sun-path maths — cross-check our own computations | Global | https://suncalc.org |
| AQICN | Live air-quality readings per city | Global | https://aqicn.org |
| WAQI | Global air-quality measurements (same network as AQICN) | Global | https://waqi.info |
| NASA FIRMS | Fire hotspots for smoke-risk context | Global | https://firms.modaps.eosdis.nasa.gov |
| earth.nullschool.net | Global wind + ocean currents | Global | https://earth.nullschool.net |
| NASA Sea Level | Sea-level change data (long-term context) | Global | https://sealevel.nasa.gov |
| Sentinel Hub | Satellite imagery (water-quality proxies) | Global | https://sentinel-hub.com |
| N2YO | Satellite + ISS pass predictions (night-sky content) | Global | https://n2yo.com |
| Spot the Station (NASA) | ISS pass times | Global | https://spotthestation.nasa.gov |
| Light Pollution Map | Dark-sky quality (night beach content) | Global | https://lightpollutionmap.info |
| OCEARCH | Tagged-shark tracking (swimmer-safety storytelling) | Global (Atlantic-heavy) | https://ocearch.org |
| Ventusky | Weather + rain + wave map (visual context) | Global | https://ventusky.com |
| NOAA Tides & Currents | Tide readings — US coverage only; useful as an adapter pattern until EU tide licensing | US | https://tidesandcurrents.noaa.gov |
| AirNow Fire & Smoke | Wildfire smoke spread | US / Canada | https://fire.airnow.gov |
| NHC | Hurricane tracking | Atlantic + East Pacific | https://nhc.noaa.gov |
| Tropical Tidbits | Storm model comparison | Storm basins | https://tropicaltidbits.com |

## Integration notes

- Keep the provider-adapter boundary: each feed lands as an adapter returning `{ source, observedAt, freshness }`, like the existing providers in `server/providers/`.
- **Coverage matters.** NOAA tide/water services are US-only — EU pilot beaches (Algarve, Rhodes) still need a licensed tide source (WorldTides / Stormglass) or a national service. The free feeds cover hazard, sky, wind, smoke, and air-quality gaps now.
- Unblocks backlog items: Tide Intelligence and Hazard Alerts (EMSC / Tsunami.gov), water-quality proxies (Sentinel Hub), smoke risk (FIRMS / AirNow).
- Keyed APIs: FIRMS + N2YO need free API keys. AQICN/WAQI work with a demo token for trials.
- Licensing: mostly public/open data (NOAA / USGS / NASA public domain); check each source's terms before commercial redistribution or resale.

## Full catalogue (50 sources)

### Weather & Climate

| # | Source | What it shows | Link |
|---|---|---|---|
| 1 | Ventusky | Weather, rain and wave map | https://ventusky.com |
| 11 | Climate Reanalyzer | Live global temperature anomaly | https://climatereanalyzer.org |
| 12 | NHC (NOAA) | Official hurricane tracking centre | https://nhc.noaa.gov |
| 13 | Tropical Tidbits | Storm models side by side | https://tropicaltidbits.com |
| 18 | NSIDC | Live polar ice status | https://nsidc.org |
| 22 | US Drought Monitor | Drought spread map | https://droughtmonitor.unl.edu |

### Ocean & Water

| # | Source | What it shows | Link |
|---|---|---|---|
| 2 | earth.nullschool.net | Global wind and ocean currents | https://earth.nullschool.net |
| 10 | OCEARCH | Track sharks in the ocean | https://ocearch.org |
| 19 | NASA Sea Level | Sea-level change data | https://sealevel.nasa.gov |
| 20 | NOAA Tides & Currents | Tide and water-level readings | https://tidesandcurrents.noaa.gov |
| 21 | USGS Water Data | Live river flows | https://waterdata.usgs.gov |
| 38 | Global Fishing Watch | The world's fishing fleets | https://globalfishingwatch.org |

### Hazards — Fire, Seismic, Volcano, Tsunami

| # | Source | What it shows | Link |
|---|---|---|---|
| 4 | NASA FIRMS | Fires seen from satellite | https://firms.modaps.eosdis.nasa.gov |
| 5 | Volcano Discovery | Live volcanic activity | https://volcanodiscovery.com |
| 14 | AirNow Fire & Smoke | Wildfire smoke spread map | https://fire.airnow.gov |
| 23 | EMSC | European earthquake monitoring centre | https://emsc-csem.org |
| 24 | SeismicPortal | Seismic data stream | https://seismicportal.eu |
| 25 | Raspberry Shake | Listen to seismometers worldwide, live | https://raspberryshake.net |
| 26 | Smithsonian GVP | Active volcano database | https://volcano.si.edu |
| 27 | Tsunami.gov | Tsunami warning centre | https://tsunami.gov |

### Air Quality

| # | Source | What it shows | Link |
|---|---|---|---|
| 15 | AQICN | Live air pollution in cities | https://aqicn.org |
| 16 | WAQI | Global air-quality measurements | https://waqi.info |

### Satellite & Earth Observation

| # | Source | What it shows | Link |
|---|---|---|---|
| 3 | NASA Worldview | Daily satellite imagery of Earth | https://worldview.earthdata.nasa.gov |
| 17 | Sentinel Hub | Inspect satellite imagery yourself | https://sentinel-hub.com |

### Space & Sky

| # | Source | What it shows | Link |
|---|---|---|---|
| 6 | Aurora Service | Northern lights forecast | https://aurora-service.eu |
| 7 | Heavens-Above | Satellite and ISS pass times | https://heavens-above.com |
| 8 | TheSkyLive | Current positions of the planets | https://theskylive.com |
| 28 | SpaceWeather.com | Solar storms and magnetic effects | https://spaceweather.com |
| 29 | NOAA SWPC | Official space weather | https://swpc.noaa.gov |
| 30 | Spot the Station (NASA) | When the ISS passes over you | https://spotthestation.nasa.gov |
| 31 | N2YO | Live satellite tracking | https://n2yo.com |
| 32 | Solar System Scope | Live solar system simulation | https://solarsystemscope.com |
| 33 | JPL CNEOS | Near-Earth objects | https://cneos.jpl.nasa.gov |
| 34 | AMS Fireballs | Meteor/fireball reports | https://fireball.amsmeteors.org |
| 35 | Light Pollution Map | Dark places where you can see stars | https://lightpollutionmap.info |
| 36 | SunCalc | The sun's path through the day | https://suncalc.org |

### Aviation & Transport

| # | Source | What it shows | Link |
|---|---|---|---|
| 9 | ADSBExchange | Unfiltered flight tracking | https://adsbexchange.com |
| 37 | OpenSky Network | Open air-traffic data | https://opensky-network.org |
| 39 | OpenRailwayMap | The world's railway network | https://openrailwaymap.org |

### Energy & Internet Infrastructure

| # | Source | What it shows | Link |
|---|---|---|---|
| 40 | Electricity Maps | Live electricity mix by country | https://electricitymaps.com |
| 41 | Energy-Charts | European energy generation data | https://energy-charts.info |
| 42 | GridWatch UK | Live grid load | https://gridwatch.co.uk |
| 43 | NetBlocks | Internet outages by country | https://netblocks.org |
| 44 | Cloudflare Radar | The internet's live traffic state | https://radar.cloudflare.com |

### Radio

| # | Source | What it shows | Link |
|---|---|---|---|
| 45 | WebSDR | Listen to radio receivers around the world | https://websdr.org |

### Wildlife & Biodiversity

| # | Source | What it shows | Link |
|---|---|---|---|
| 46 | BirdCast | Watch bird migration on radar | https://birdcast.info |
| 47 | eBird | Live bird-sighting maps | https://ebird.org |
| 48 | Movebank | Animal migration route data | https://movebank.org |
| 49 | iNaturalist | Live nature observations worldwide | https://inaturalist.org |
| 50 | GBIF | Global biodiversity database | https://gbif.org |

## Provenance

- Source list: https://x.com/mertmetindev/status/2099430384706396320 (14 Sep 2026) — recovered 2026-09-15 via a public syndication mirror (X blocks automated fetching of the post itself); translated from Turkish.
- Link verification 2026-09-15: 46/50 hosts respond HTTP 200. Four are bot-walled to scripted checks but are well-known live services: theskylive.com, volcano.si.edu, gbif.org (API confirmed responding at api.gbif.org), radar.cloudflare.com.
- Public API/feed endpoints spot-checked and responding: tsunami.gov Atom, NHC Atom, GBIF API, iNaturalist API, EMSC FDSN JSON, OpenSky API.
