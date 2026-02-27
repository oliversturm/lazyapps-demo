# LazyApps Demo

Demo applications for the [LazyApps](https://github.com/oliversturm/lazyapps-libs) event-sourcing and CQRS framework. LazyApps provides a pluggable architecture for Node.js where each concern — command processing, event storage, event distribution, read model projection, and change notification — can be backed by different technologies and wired together via a single `start()` call. The same codebase supports deployment topologies ranging from a single-process monolith to fully distributed services.

This repository contains three demo configurations that showcase these topologies, all implementing the same sample application (customers and orders) with Svelte (and React) frontends.

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

## LLM Demo

Extends the orchestrated architecture with LLM integration, demonstrating how large language models fit into an event-sourced system. Runs as a Docker Compose stack with the same core services (command processor, read models, change notifier, MongoDB, RabbitMQ, Traefik) plus an event history read model and LLM endpoints served through the SvelteKit frontend. Uses an OpenAI-compatible API — works with OpenAI, DeepInfra, Ollama, LM Studio, or any compatible provider. A built-in mock LLM client allows running the full demo without an API key.

The demo implements six LLM features that progress from informational to consequential:

1. **Natural language command creation** — type plain English in the assistant panel to generate structured LazyApps commands (create/update customers, create/confirm/decline orders). Commands are previewed for review before dispatch through the normal pipeline. The LLM uses tool calling to look up existing entities (with fuzzy search) so it can reference correct aggregate IDs.

2. **Trend analysis** — event-driven risk assessment triggered by order events. When a customer accumulates orders, the system calls the LLM to evaluate risk level and score. Results are stored per-customer and visualized as line charts in a dedicated Risk tab. Analysis also runs on-demand from the assistant panel.

3. **Reputation-based order confirmation** — the existing order confirmation flow is augmented with LLM reputation evaluation. On each confirmed or declined order, the LLM assesses customer reputation (good/neutral/poor) which determines the auto-confirm threshold: well-regarded customers get a higher value threshold, customers with low reputation always require manual confirmation. The LLM advises; domain logic decides.

4. **RAG customer service** — a dedicated chat page where natural language questions are answered from live read model data. The LLM uses tool calling to query customers and order statistics autonomously, then formulates grounded answers. Useful for questions like "who are our best customers?" or "what products should we stock?".

5. **Event history explanation** — ask why something happened and the LLM narrates the causal chain from the event history read model. Explains reputation assessments, confirmation decisions, and order state transitions.

6. **Quick analysis from the assistant panel** — the Chat tab includes a quick analysis section where you can select an analysis type (product suggestions, interest categories, erroneous order detection, risk assessment) and run it for a specific customer or across all orders. Results feed into the Risk tab when applicable.

All LLM interactions follow the principle that the LLM classifies and advises but never directly modifies data — domain logic always makes the final decision. Reputation reasoning is stored and queryable for auditability.

```bash
# Build all service images
pnpm llm:build

# Start the stack (runs with mock LLM by default — no API key needed)
pnpm llm:start

# Seed sample data for presentations
pnpm llm:seed

# Tail logs with syntax highlighting
pnpm llm:logs

# Run end-to-end tests
pnpm llm:test:e2e

# Stop all containers and remove volumes
pnpm llm:down
```

To use a real LLM provider, copy the example environment file and edit it:

```bash
cp packages/llm-demo/.env.example packages/llm-demo/.env
# Edit .env — set LLM_MOCK=false, add your LLM_API_KEY, and optionally configure LLM_BASE_URL and LLM_MODEL
pnpm llm:start
```

All services are exposed via Traefik on port 80 using `.localhost` subdomains:

| Endpoint | Description |
| -------- | ----------- |
| `http://llm-demo.localhost` | Svelte frontend |
| `http://commands.localhost` | Command processor API |
| `http://rm-customers.localhost` | Customers read model API |
| `http://rm-orders.localhost` | Orders read model API |
| `http://rm-events.localhost` | Event history read model API |
| `http://change-notifier.localhost` | Change notifier (Socket.io) |
| `http://dashboardUI.localhost` | Aspire Dashboard |

The Traefik dashboard is available at `http://localhost:8080`.

The frontend includes pages for customers, orders, order confirmation requests, a customer service chat, and per-entity detail views. An LLM assistant panel with Chat, Reputation, and Risk tabs is available on all main pages.

## Utility Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm pnpm-update` | Update all dependencies across the workspace to latest |
| `pnpm use-branch <branch>` | Switch `@lazyapps/*` deps to snapshot versions from a feature branch |
| `pnpm use-released` | Restore `@lazyapps/*` deps to released npm versions |
| `pnpm test:e2e` | Run end-to-end tests (orchestrated) |
| `pnpm llm:test:e2e` | Run end-to-end tests (LLM demo) |

## License

ISC
