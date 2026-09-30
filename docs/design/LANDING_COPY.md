# OpenMCP Landing Copy Guidelines

Product source of truth: [`apps/docs/PRODUCT.md`](../../docs/PRODUCT.md).

## Positioning

**Primary:** OpenMCP is an **MCP / A2A / Skills marketplace**.
Providers publish; users acquire assets free or paid and install them into Agents.

**Secondary (do not lead with):**
- Personas assembly
- Clawsourcing / OpenClaw custom services
- OpenPay monetization / settlement
- “AI App Store infrastructure / launch in 10 minutes” infra pitch

Infrastructure and monetization may appear as supporting lines, never as the hero narrative.

## Landing surfaces

| Surface | Intent |
|---------|--------|
| Hero | Discover & install assets; dual CTAs: browse marketplace + become Provider; copy install prompt → `/start` |
| `/start` | Three steps: copy prompt → browse Skills/MCP/A2A → optional Provider. Stub section for future one-click “install into Agent” (copy only; no install API yet) |
| Protocol showcase | Marketplace standards + browse / Provider CTAs |
| Revenue / OpenPay / Onboarding CTAs | Soften monetization; publish & discover first |
| Navbar | Skills → MCP → A2A → Personas (Personas not first) |
| Footer | Skills / MCP / A2A / Personas / Getting started; marketplace tagline |

## Install prompt

Shared constant: `src/lib/marketing/install-prompt.ts` (`INSTALL_PROMPT` / `INSTALL_PROMPT_EN`).

Used by Hero, Protocol showcase, and `/start`. Describes the manual browse + copy flow until the store MCP install API is confirmed.

## Out of scope (this pass)

- Store MCP install API / agent install endpoints
- Deep Clawsourcing or n8n workflow community repositioning beyond home/nav/footer leftovers
