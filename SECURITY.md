# Security Policy

## Supported versions

The latest minor release receives security updates. Older minors are
not patched once a newer minor ships.

| Version                | Supported |
| ---------------------- | --------- |
| `main` branch (latest) | ✅        |
| Older releases         | ❌        |

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.**

Send a private report to **[security@shenxiaoli.example]** with:

1. A clear description of the issue and the impact you observed.
2. Steps to reproduce (URL, browser, request/response if applicable).
3. Any known workarounds.
4. Whether you'd like to be credited in the fix.

We acknowledge reports within **3 business days** and aim to ship a fix
within **30 days**, depending on severity.

## Disclosure policy

We follow **coordinated disclosure**:

- We will work with you to understand the issue and prepare a fix.
- Once a fix is ready, we publish a release and a CVE (if applicable)
  simultaneously.
- Reporters are credited in the release notes unless they ask to remain
  anonymous.

## Scope

This repository currently contains **only the frontend**. Reports about
server-side behavior cannot be evaluated here — please verify the
report against the deployed frontend before sending.

## Out of scope

The following are generally not security issues:

- Vulnerabilities in third-party CDNs we link to (e.g. Google Fonts,
  Material Symbols).
- Clickjacking against the static demo pages (they have no auth).
- Lack of rate limiting on a frontend-only demo.

If you're unsure, send the report — we'll triage.
