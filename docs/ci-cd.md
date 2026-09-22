# CI/CD

## Branches and Cloudflare environments

| Branch    | Environment  | Workers Builds command                  | Result                                                                                                                       |
| --------- | ------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `develop` | `dev`        | `node scripts/deploy-ci.mjs dev`        | Deploys immediately to `https://dev.bridge.fairleadhq.com`.                                                                  |
| `main`    | `production` | `node scripts/deploy-ci.mjs production` | Uploads a version for `https://bridge.fairleadhq.com`; a platform operator promotes it manually in the Cloudflare dashboard. |

Cloudflare Workers Builds performs deployment. GitHub Actions does not receive
Cloudflare credentials and never uploads or promotes a Worker version.

## Validation

`.github/workflows/ci.yml` runs for pull requests and pushes targeting `develop`
or `main`. It installs the locked dependencies, runs coverage, typecheck, lint,
formatting, and dry-runs both deployment environments through
`scripts/deploy-ci.mjs`.

## Deployment metadata and rollback

Every upload receives the tag `v<package.json version>-<short commit SHA>` and
the tip commit subject as its message. The script supplies build constants for
future runtime build metadata as `__APP_VERSION__` and `__APP_COMMIT__`.

To roll back production, use the Cloudflare dashboard to promote a previous
Worker version. Do not run a fresh deploy solely to roll back.
