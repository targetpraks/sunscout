# SunScout Local Development

## Start the database

```bash
npm run db:up
npm run db:migrate
npm run db:seed
```

PostgreSQL listens on `127.0.0.1:55432`.

## Start the applications

In separate terminals:

```bash
npm run dev:api
npm run dev
```

- Consumer app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787/api`

The frontend uses the API when available and falls back to bundled development data when it is offline.

## Verify

```bash
npm run typecheck
npm run build
npm run test:api
```

## Development identity

Until external authentication is connected, requests use:

```text
x-sunscout-user-id: 00000000-0000-7000-8000-000000000001
```

The API resolves this public identifier to an internal sequential user key. Replace this header adapter with verified Clerk JWT middleware before any shared environment is exposed.

## Database approach

- PostgreSQL is the system of record.
- Internal primary keys use `bigint identity`.
- Public API identifiers use UUIDs with unique indexes.
- All foreign keys and primary filter paths are indexed.
- Conditions preserve source, observed time, received time, and raw provider metadata.
- Booking creation locks inventory rows inside a transaction before decrementing availability.
