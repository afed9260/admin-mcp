# Customer Operations MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP tools that let Codex read Customer Operations profiles and safely dry-run/apply one dialog-launch credit grant.

**Architecture:** Reuse the existing admin-mcp structure: Zod schemas live in `src/tools/schemas.ts`, backend calls live in a focused `customer-operations-tools.ts`, and registration/audit stays in `register-tools.ts`. Readonly and safe automation tools are always registered; apply is a write tool gated by `ADMIN_MCP_ENABLE_WRITE=true`.

**Tech Stack:** TypeScript, MCP TypeScript SDK, Zod, Vitest, existing `AdminApiClient`.

---

## Files

- Create: `src/tools/customer-operations-tools.ts`
- Modify: `src/tools/schemas.ts`
- Modify: `src/tools/register-tools.ts`
- Modify: `test/tool-registration.test.ts`
- Create: `test/customer-operations-tools.test.ts`
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-06-04-customer-operations-mcp-tools-design.md`
- Create: `docs/superpowers/plans/2026-06-04-customer-operations-mcp-tools.md`

## Tasks

- [x] Add failing registration tests for the three tool names and gating.
- [x] Add failing customer operations tool tests for profile, dry-run, apply, and `confirm` stripping.
- [x] Add Zod schemas for profile lookup and credit grant.
- [x] Implement `createCustomerOperationsTools`.
- [x] Register the tools with existing audit annotations.
- [x] Update README tool list.
- [x] Run tests, typecheck, and build.
- [ ] Commit, push, create PR, merge, and verify the MCP server can expose the new tools after redeploy/reload.
