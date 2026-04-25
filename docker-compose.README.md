# Docker Compose Local Stack

This repository now includes a full local stack:

- `app` (Next.js dev server)
- `postgres` (local Postgres with auth bootstrap SQL)
- `minio` (resume storage)

## 1) Start the stack

```bash
docker compose up -d
```

Then stream logs:

```bash
docker compose logs -f app
```

App URL: `http://localhost:3000`

## 2) Stop the stack

```bash
docker compose down
```

To also remove volumes:

```bash
docker compose down -v
```

## Notes

- `DATABASE_URL` is overridden in compose to use container DNS: `postgres:5432`.
- `MINIO_ENDPOINT` is overridden in compose to use `http://minio:9000`.
- `postgres` initializes with:
  - `lib/postgres/auth-bootstrap.sql`
  - `docker/postgres/02-profiles.sql`

If you need the full schema/data for all app pages, import your SQL dump into the `postgres` service:

```bash
docker compose exec -T postgres psql -U busy -d hireoven < data.sql
```
