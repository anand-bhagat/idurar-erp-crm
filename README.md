# IDURAR ERP/CRM - AI Agent Edition

> An open-source ERP/CRM with invoicing, payments, and client management - extended with a conversational AI agent that can perform real actions through natural language.
>
> Forked from [IDURAR](https://github.com/idurar/idurar-erp-crm) and extended with a full AI agent layer.
>
> **Live Demo:** [idurar.anandbhagat.com](https://idurar.anandbhagat.com/)

## What I Built

The original IDURAR is a MERN stack ERP/CRM with invoicing, quotes, payments, and client management using Ant Design. I forked it and added a **conversational AI agent** that can perform real actions across the entire application through natural language - managing clients, creating invoices, recording payments, looking up tax rates, navigating pages, and more.

### AI Agent Features

- **Tool-calling architecture** - The agent uses structured tool definitions (not prompt hacking) to interact with the app's APIs
- **50 tools across 8 categories** - Full CRUD coverage for clients, invoices, payments, payment modes, taxes, settings, admin profile, and navigation
- **SSE streaming** - Real-time streamed responses with status indicators during tool execution
- **Frontend actions** - The agent can navigate to any page in the app directly from conversation
- **Confirmation flow** - Destructive actions (delete client, etc.) require user confirmation before execution
- **Multi-tool chaining** - The agent chains tools automatically (e.g., search for a client by name, then create an invoice for them - in one turn)
- **Provider-agnostic** - Works with OpenAI, Anthropic Claude, Groq, DeepInfra, OpenRouter, Ollama, and any OpenAI-compatible API
- **Two-stage tool routing** - For scale: a fast LLM classifies intent into categories, then only relevant tools are sent to the main LLM
- **Guardrails** - Input sanitization, prompt injection detection, circuit breakers, rate limiting, and token budgets
- **Structured observability** - JSON logging with trace IDs, token/cost tracking, latency percentiles per tool

### Agent Capabilities

| Category | Actions |
|----------|---------|
| Clients | Get, list, search, create, update, delete, summary stats |
| Invoices | Get, list, search, create, update, delete, financial summary |
| Payments | Get, list, search, create, update, delete, financial summary |
| Payment Modes | Get, list, search, create, update, delete |
| Taxes | Get, list, search, create, update, delete |
| Settings | Get, list, update, bulk update |
| Admin | View and update profile |
| Navigation | Route to any page in the app |

### Architecture

```
User message --> Router LLM (classifies intent) --> Main LLM (with relevant tools) --> Tool execution --> Streamed response
                                                          |                                  |
                                                    Provider-agnostic              Backend API calls
                                                    adapter layer                  + Frontend navigation
```

**Key components I built:**
- `backend/src/agent/` - Engine, registry, router, config, helpers
- `backend/src/agent/tools/` - 50 tools across 8 domain files (clients, invoices, payments, payment-modes, taxes, settings, admin, navigation)
- `backend/src/agent/llm/` - Provider-agnostic adapter layer (OpenAI-compatible + Anthropic) with prompt caching support
- `backend/src/agent/guardrails/` - Sanitizer, injection detector, circuit breaker, rate limiter, token budget, result cache
- `backend/src/agent/observability/` - Structured JSON logger and metrics (tool frequency, latency percentiles, error rates, cost tracking)
- `frontend/src/components/AgentChat/` - Chat widget (7 components) with SSE streaming and tool result rendering
- `backend/src/agent/evals/` - Automated eval system with 57+ test cases and regression detection

### Demo Mode

The app runs as a portfolio demo:
- Hourly database reset via `node-cron` - experiment freely, data resets every hour
- Seed data with stable IDs (admin, clients, invoices, payments, taxes)
- Docker-ready deployment with `Dockerfile` and `docker-compose.yml`

---

## Original IDURAR Features

All original features from the IDURAR project are preserved:

- Invoice management with line items, tax calculation, and status tracking
- Payment recording with credit tracking against invoices
- Quote management
- Client/customer management
- Admin user management
- Ant Design (AntD) UI framework
- Multi-currency and multi-language support

## Tech Stack

- **Frontend:** React, Ant Design (AntD), Redux, React Router
- **Backend:** Node.js, Express, MongoDB, Mongoose
- **AI Layer:** OpenAI-compatible + Anthropic LLM adapters, tool-calling, SSE streaming, two-stage routing
- **Testing:** Jest (745 tests across 23 suites)
- **Infrastructure:** Docker, node-cron (DB reset), JWT auth

## Usage

### Env Variables

Copy `backend/.env.example` to `backend/.env` and configure:

```env
# Database
DATABASE=mongodb://localhost:27017

# JWT
JWT_SECRET=your_private_jwt_secret_key

# Agent LLM (pick one provider)
AGENT_LLM_PROVIDER=openai-compatible
AGENT_LLM_API_KEY=your-api-key
AGENT_LLM_BASE_URL=https://api.deepinfra.com/v1/openai
AGENT_LLM_MODEL=zhipu-ai/glm-4.7-flash
```

Supported providers: OpenAI, Anthropic, Groq, DeepInfra, OpenRouter, Ollama (local). See `.env.example` for all options.

### Install & Run

```bash
# Install backend dependencies
cd backend
npm install

# Run setup (creates admin user + seed data)
npm run setup

# Start the backend server
npm run dev

# In a new terminal - install and start frontend
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker-compose up --build
```

### Run Tests

```bash
cd backend
npx jest src/agent/tests/ --no-coverage
```

### Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@admin.com | admin123 |

---

## Credits

- Original IDURAR ERP/CRM by [idurar](https://github.com/idurar/idurar-erp-crm)
- AI agent layer, tool system, streaming architecture, demo mode, and Docker setup by [Anand Bhagat](https://github.com/anand-bhagat)

## License

The original IDURAR project is released under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
