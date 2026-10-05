# Slice 1, step 2: built-in connectors and the AI proxy (decision record)

Date: 2026-10-04. Owner: Sushanth. Status: decided, provider terms still being verified (see table).

## Decisions (owner)

1. Built-in keyless connectors: start with weather, crypto prices and a public-holiday or geocoding API. A provider is included only if its published terms allow commercial use without an account. VibeBuild is a commercial product, so "free for non-commercial use" is a disqualifier.
2. The AI proxy calls go through the platform OpenRouter key and count against each app's daily spend cap.
3. Default AI allowance: $0.05 per app per day, until pricing is set. This is a default, not a final price.
4. Everything is built locally and test-first on branch `tier1-slice1`. Nothing is deployed and no production system (Supabase project, OpenRouter key usage, Fly) is changed without a separate approval.

## Provider terms (read 2026-10-04 from the providers' own pages; quotes are the fetched summaries, not legal advice)

| Provider | Use | Finding | Decision |
|---|---|---|---|
| Open-Meteo free API | weather | "You may only use the free API services for non-commercial purposes." Commercial use needs a paid plan. | EXCLUDED on the free tier |
| US National Weather Service (api.weather.gov) | weather, US | "open data, free to use for any purpose", no fees. A unique User-Agent header is required and "will be replaced with an API key in the future". Rate limit not published. US-focused. | INCLUDE for US weather; send a unique User-Agent; expect an API key later |
| Nager.Date (nagerholidays.com) | public holidays | Redirects from date.nager.at; terms not yet read | PENDING |
| Binance public market data (data-api.binance.vision) | crypto prices | Keyless market data only. The page states no commercial-use or redistribution terms and points to Binance's general terms, which have not been read. | PENDING, not included until the terms are read |

## Consequences

- Global weather has no keyless commercial source in this list. Options: US-only via NWS, a paid Open-Meteo plan, or a creator-supplied key through the secrets connector. This is open.
- Every built-in connector must carry its terms review date and source URL in code, so a stale review is visible.
- Revisit all providers' terms before launch; they can change.
