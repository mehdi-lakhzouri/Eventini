# Eventini Docker Stack

This folder contains the local Docker stack for Eventini infrastructure.

## Versions

- PostgreSQL: `18.4`
- pgAdmin 4: `9.16`
- Redis: `8.8`

## Services

| Service | Container | Image | Port |
| --- | --- | --- | --- |
| PostgreSQL | `eventini-postgres` | `postgres:18.4` | `5433 -> 5432` |
| pgAdmin 4 | `eventini-pgadmin` | `dpage/pgadmin4:9.16` | `5051 -> 80` |
| Redis | `eventini-redis` | `redis:8.8` | `6380 -> 6379` |

## Network

The stack creates a Docker bridge network named:

```bash
Eventini
```

## Volumes

The stack creates these named Docker volumes:

```bash
eventini_postgres_18_data
eventini_pgadmin_data
eventini_redis_data
```

PostgreSQL 18 stores data under a major-version-specific directory. The
PostgreSQL volume is mounted at `/var/lib/postgresql`, not
`/var/lib/postgresql/data`.

## Credentials

Credentials are stored in `.env`. Do not commit this file to a public repository.

## Commands

Start the stack:

```bash
docker compose --env-file .env up -d
```

Check containers:

```bash
docker compose --env-file .env ps
```

View logs:

```bash
docker compose --env-file .env logs -f
```

Stop the stack:

```bash
docker compose --env-file .env down
```

Stop and remove volumes:

```bash
docker compose --env-file .env down -v
```

If older containers were created under the implicit Compose project named
`docker`, remove only the old Eventini containers before starting the fixed
stack:

```bash
docker rm -f eventini-postgres eventini-pgadmin eventini-redis
```

If the old PostgreSQL volume was created with the invalid PostgreSQL 18 mount
layout and you do not need its data, remove it too:

```bash
docker volume rm eventini_postgres_data
```

Connect to PostgreSQL from another container on the `Eventini` network:

```text
Host: postgres
Port: 5432
Database: value of POSTGRES_DB
User: value of POSTGRES_USER
Password: value of POSTGRES_PASSWORD
```

Open pgAdmin:

```text
http://localhost:5051
```

Connect to Redis locally:

```bash
redis-cli -h localhost -p 6380 -a "<REDIS_PASSWORD>"
```

Local host ports are intentionally offset from the usual PostgreSQL, pgAdmin,
and Redis ports so another local project can keep using `5432`, `5050`, and
`6379`.
