# Security Policy

## Supported Scope

Security reports are accepted for current active branches:

1. `main`
2. `development`

## Reporting a Vulnerability

Do not open public issues for vulnerabilities.

Report privately by email:

- hk8913114@gmail.com
- Subject: `Security Report - backend - <short title>`

Include:

1. Vulnerability description.
2. Impact and affected components.
3. Reproduction steps or PoC.
4. Suggested mitigation (optional).
5. Your contact details.

## Response Targets

1. Initial acknowledgment: within 72 hours.
2. Triage decision: within 7 days.
3. Fix timeline: based on severity and exploitability.

## Disclosure Process

1. Report received and triaged.
2. Fix prepared and validated.
3. Patch released.
4. Coordinated disclosure published when appropriate.

## Severity Guidelines

1. Critical: auth bypass, RCE, payment/webhook forgery, major data exposure.
2. High: privilege escalation, IDOR with sensitive impact, significant integrity issues.
3. Medium: limited data leakage, moderate logic abuse.
4. Low: hardening opportunities with low exploitability.

## Safe Harbor

We support good-faith security research that:

1. Avoids privacy violations and service disruption.
2. Avoids accessing/modifying other users' data.
3. Is reported responsibly and privately.

## Notes

License/commercial-policy questions are not security reports. Use regular support channels in [SUPPORT.md](./SUPPORT.md).
