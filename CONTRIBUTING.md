# Contributing to Backend

Thanks for your interest in contributing.

This repository uses a strict licensing and security-first workflow. Please read this guide fully before opening issues or pull requests.

## Before You Start

1. Read [LICENSE](./LICENSE), [LICENSING-GUIDE.md](./LICENSING-GUIDE.md), and [FORK_LICENSE_RENEWAL_NOTICE.md](./FORK_LICENSE_RENEWAL_NOTICE.md).
2. Review [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
3. For vulnerabilities, do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Development Setup

1. Install dependencies:

```bash
yarn install
```

2. Create local environment files as needed (`.env`, `.env.local`).
3. Start development services according to project docs.

## Branching Strategy

1. Branch from `main` for all new work.
2. Use focused branch names:
   - `fix/<short-topic>`
   - `feat/<short-topic>`
   - `security/<short-topic>`
   - `docs/<short-topic>`
3. Keep changes scoped. Avoid mixing unrelated fixes.

## Commit Convention

Use Conventional Commits:

```text
<type>(<scope>): <short description>
```

Examples:

- `fix(auth): prevent token replay on webhook callback`
- `security(cod): enforce otp retry cap`
- `docs(licensing): clarify commercial restrictions`

Recommended types: `feat`, `fix`, `security`, `refactor`, `docs`, `test`, `chore`, `perf`.

## Pull Request Rules

1. Link the issue (if any).
2. Explain what changed and why.
3. Include test evidence and risk notes.
4. Keep PRs reviewable.
5. Do not include generated noise files unless required.

Required checks before merge:

1. Build and type checks pass.
2. Security and license guard checks pass.
3. CODEOWNERS review requirements are met.

## Coding and Security Expectations

1. Never trust user input.
2. Enforce authz ownership checks for customer data.
3. Use fail-closed behavior in security paths.
4. Avoid leaking secrets in logs.
5. Follow existing linting and TypeScript standards.

## Testing Checklist

Run relevant checks locally before creating a PR:

```bash
yarn build
yarn tsc --noEmit
yarn eslint src/
```

Run focused tests for changed modules and include results in PR description.

## Issue Quality Standards

When filing an issue, provide:

1. Expected vs actual behavior.
2. Repro steps.
3. Environment details.
4. Logs/screenshots where useful.

Use issue templates in `.github/ISSUE_TEMPLATE/`.

## Licensing Reminder for Contributors

Submitting a contribution does not grant commercial usage rights.

Commercial usage remains controlled by:

1. [LICENSE](./LICENSE)
2. [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)
3. [COMMERCIAL-LICENSE-AGREEMENT.md](./COMMERCIAL-LICENSE-AGREEMENT.md)

## Need Help?

See [SUPPORT.md](./SUPPORT.md) for support paths.
