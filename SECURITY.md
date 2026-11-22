# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository's **Security** tab (private vulnerability reporting). Do not open a public issue, discussion or pull request for a security problem.

Include what you found, how to reproduce it, and the impact you expect. Fixes are noted in [CHANGELOG.md](CHANGELOG.md).

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## How Phean protects workspaces

[content/docs/security.md](content/docs/security.md) (served at `/docs/security`) describes the security model: tenant isolation, the role matrix, agent credentials and liveness, webhook URL safety, payload contents, and browser protections. Operators should also read the environment variables in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); in particular, set `BETTER_AUTH_SECRET` and `CRON_SECRET` on every deployment.
