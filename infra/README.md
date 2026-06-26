# infra — containerization

Dockerized service boundary for the monorepo.

## Layout

```
infra/
  compose.yaml            # production-shaped services (web, agent-runtime, api-python)
  compose.override.yaml   # local dev overrides (source mounts, dev servers)
  docker/
    Dockerfile.web
    Dockerfile.agent-runtime
    Dockerfile.api-python
    docker-entrypoint.sh
```

All images use the **repo root** as their build context so they can resolve the
pnpm workspace.

## Commands

```bash
# validate the compose file (no daemon required)
docker compose -f infra/compose.yaml config

# build all images (requires a running Docker daemon)
docker compose -f infra/compose.yaml build

# run locally (dev overrides apply automatically)
docker compose -f infra/compose.yaml up
```

## Ports

| Service       | Port |
| ------------- | ---- |
| web           | 3000 |
| api-python    | 8000 |
| agent-runtime | (worker; no exposed port) |

## Notes

- Secrets are never baked into images. Runtime config comes from environment
  variables (see `.env.example`); `compose.yaml` uses `${VAR:-}` defaults so
  `config` validates without a populated `.env`.
- The web image builds without prebuilding `@repo/shared-schemas` (the app
  resolves schema types from source via tsconfig paths).
