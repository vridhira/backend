# Changelog — Vridhira Backend

All notable changes to the Vridhira backend are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Conventional Commits](https://www.conventionalcommits.org/).

---

## [Unreleased]

### Security 🔐
- **BUG-001**: Replace Meilisearch master key with scoped API key — startup guard in `meilisearch/service.ts` detects master/admin keys and throws in production; warns in dev. New setup script `src/scripts/create-meilisearch-scoped-key.ts` creates a least-privilege key (documents.add/get/delete + indexes.search/update on products index only).

### Added ✨
- Security tooling: `eslint-plugin-security`, `eslint-plugin-no-secrets`, `secretlint`, `@typescript-eslint` devDependencies
- `.eslintrc-security.js` — security-focused ESLint config with rules for Math.random, eval, ReDoS, timing-unsafe comparisons, deprecated crypto, secret detection
- `.secretlintrc.json` — secretlint config using recommended preset
- `BUGS.md` — living vulnerability tracker with 12 initial findings from security audit
- `CHANGELOG.md` — this file
- `SECURITY_ANALYSIS.md` — full security analysis report
- `src/scripts/create-meilisearch-scoped-key.ts` — one-time setup script for Meilisearch scoped key (BUG-001 fix)
- `package.json` `security:*` scripts: `security:audit`, `security:eslint`, `security:secrets`, `security:idor`, `security:timing`, `security:math-random`, `security:full`, `precommit`, `prepush`

### Changed 🔄
- `docs/check-before-development.md` Section 25 — Meilisearch setup now documents scoped key requirement, BUG-001 warning, and step-by-step key creation workflow
- `.env` Meilisearch section — placeholder changed from master key to scoped key; added `MEILISEARCH_MASTER_KEY` commented-out placeholder for setup script use

---

## [1.0.0] — 2026-02-25 (Initial Audit)

### Security 🔐
- Identified 12 vulnerabilities via security audit (see BUGS.md)
- Confirmed secure patterns: HMAC webhook verification, timingSafeEqual comparisons, auth_context IDOR prevention, OTP HMAC storage, fail-closed webhook guards
- Added security tooling: ESLint security rules, VS Code security tasks, Copilot agent instructions

### Known Open Issues
- BUG-001: Meilisearch master key in production (Critical)
- BUG-002: Shiprocket webhook token logged in access logs (Critical)
- BUG-003: Cart completion race condition (Critical)
- BUG-004: No rate limiting on auth endpoints (High)
- BUG-005: Refund email silent failure at >500 payments (High)
- BUG-006: COD OTP rate limit bypassed on Redis outage (High)
- BUG-007: Google OAuth CSRF state validation needs verification (High)
- BUG-008: Shiprocket fulfillment failure not alerted (High)
- BUG-009: Multi-instance in-memory cache breakage (High)
- BUG-010: Order cancellation not propagated to Shiprocket (Medium)
- BUG-011: Duplicate product reviews allowed (Low)
- BUG-012: No request body size limits (Medium)

---

<!-- 
## Template for New Releases

## [X.Y.Z] — YYYY-MM-DD

### Security 🔐
- security(scope): description [BUG-XXX]

### Fixed 🐛
- fix(scope): description [BUG-XXX]

### Added ✨
- feat(scope): description

### Changed 🔄
- refactor(scope): description

### Breaking Changes ⚠️
- description of breaking change

-->
