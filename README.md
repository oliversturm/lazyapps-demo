# LazyApps Demo

Demo applications for the [LazyApps](https://github.com/oliversturm/lazyapps-libs) event-sourcing and CQRS framework. LazyApps provides a pluggable architecture for Node.js where each concern — command processing, event storage, event distribution, read model projection, and change notification — can be backed by different technologies and wired together via a single `start()` call. The same codebase supports deployment topologies ranging from a single-process monolith to fully distributed services.

This repository contains two demo configurations that showcase these topologies, both implementing the same sample application (customers and orders) with Svelte and React frontends.

## Prerequisites

- Node.js 18.20.3+ or 20.18.0+
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/)

## Monolith Demo

Runs all components in a single Node.js process: command processor, read models, change notifier, and a SvelteKit dev server. Uses in-process MQEmitter for inter-component communication and MongoDB for event and read model storage. Includes OpenTelemetry observability via `--import` preload.

```bash
# Install dependencies (only needed for the monolith — orchestrated services build their own images)
pnpm install

# Start MongoDB and Aspire Dashboard (telemetry UI) containers
pnpm mono:start-services

# Start the monolith (with log highlighting)
pnpm mono:start

# Stop background services
pnpm mono:stop-services
```

| Endpoint | Description |
| -------- | ----------- |
| `http://localhost:5173` | SvelteKit frontend |
| `http://localhost:18888` | Aspire Dashboard (traces and logs) |

## Orchestrated Demo

Runs each component as a separate Docker container: command processor, two read model services (customers, orders), change notifier, plus Svelte and React frontends. Uses RabbitMQ for event distribution, Traefik as reverse proxy, and MongoDB for storage. Several observability backend profiles are available.

```bash
# Build all service images
pnpm orch:build

# Start with one of the observability backends:
pnpm orch:start         # Aspire Dashboard (default)
pnpm orch:aspire        # same as above
pnpm orch:grafana       # Grafana LGTM (traces + metrics + logs)
pnpm orch:jaeger        # Jaeger (traces)
pnpm orch:signoz        # SigNoz (traces + metrics + logs)

# Tail logs with syntax highlighting
pnpm orch:logs

# Stop all containers and remove volumes
pnpm orch:down
```

All services are exposed via Traefik on port 80 using `.localhost` subdomains:

| Endpoint | Description |
| -------- | ----------- |
| `http://svelte.localhost` | Svelte frontend |
| `http://react.localhost` | React frontend |
| `http://commands.localhost` | Command processor API |
| `http://rm-customers.localhost` | Customers read model API |
| `http://rm-orders.localhost` | Orders read model API |
| `http://rm-dotnet.localhost` | .NET read model API |
| `http://change-notifier.localhost` | Change notifier (Socket.io) |
| `http://dashboardUI.localhost` | Aspire Dashboard |
| `http://grafana.localhost` | Grafana (when using `orch:grafana`) |
| `http://jaeger.localhost` | Jaeger UI (when using `orch:jaeger`) |
| `http://signoz.localhost` | SigNoz UI (when using `orch:signoz`) |

The Traefik dashboard itself is available at `http://localhost:8080`.

## Utility Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm pnpm-update` | Update all dependencies across the workspace to latest |
| `pnpm use-branch <branch>` | Switch `@lazyapps/*` deps to snapshot versions from a feature branch |
| `pnpm use-released` | Restore `@lazyapps/*` deps to released npm versions |
| `pnpm test:e2e` | Run end-to-end tests |

## License

ISC
