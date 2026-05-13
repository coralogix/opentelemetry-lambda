---
name: nodejs-upstream-refresh
description: Use when updating the Node.js Lambda layer forks in this repository from upstream OpenTelemetry experimental tags, preserving Coralogix branch logic, rebuilding, deploying the layer, deploying the test infra, verifying traces in Coralogix, and preparing PRs.
---

# Node.js Upstream Refresh

Use repo entrypoint: `./dev/nodejs-upstream-sync.sh`.

This skill lives in this repository at `skills/nodejs-upstream-refresh/SKILL.md`.

## Workflow

1. Run `./dev/nodejs-upstream-sync.sh status`.
2. Read `.codex/nodejs-upstream-sync/reports/core-summary.txt` and `contrib-summary.txt`.
3. If `Core target tag` is empty, stop.
4. Run `./dev/nodejs-upstream-sync.sh prepare`.
5. If merge conflicts happen, preserve Coralogix logic from `coralogix-autoinstrumentation`.
   Use compare reports to see what exists on branch but not in last merged upstream tag.
6. Upstream merge commits should be unsigned. Repo script already forces `commit.gpgsign=false` for merge commits.
7. Run `./dev/nodejs-upstream-sync.sh sync-package-refs`.
8. Run `./dev/nodejs-upstream-sync.sh build`.
9. Run `./dev/nodejs-upstream-sync.sh deploy-layer`.
10. If layer deploy fails on auth, script retries after `aws sso login`.
11. Use returned layer ARN with `./dev/nodejs-upstream-sync.sh update-test-infra <layer-arn>`.
12. Run `./dev/nodejs-upstream-sync.sh deploy-test-infra`.
13. If the user asks to test, treat that as full e2e testing:
    call real endpoints, wait for ingestion, and verify traces in Coralogix with `cx`.
    Do not stop at build success, deploy success, or `UPDATE_IN_PROGRESS`.
14. For HTTP smoke, prefer both API Gateway endpoints and the Lambda URL when available.
15. Record exact evidence:
    endpoint URLs called, HTTP status, trace IDs or request IDs returned, deployed layer ARN, and functions confirmed to use that layer.
16. Only report e2e success after `cx` shows matching traces for the fresh requests you generated.
17. Run `./dev/nodejs-upstream-sync.sh create-main-branch` only if the user wants branch prep.
18. Run `./dev/nodejs-upstream-sync.sh push-prs` only if the user explicitly asks for PRs.

## Coralogix Verification

Use this order:

1. Use `cx search-fields 'trace id' --dataset spans` or `cx search-fields 'trace id' --dataset logs` if field names are unclear.
2. Query spans with `cx spans '<dataprime-query>' --start now-15m --limit 50`.
3. Query logs with `cx logs '<dataprime-query>' --start now-15m --limit 50`.

Start with broad filters. Narrow only after you confirm service, application, subsystem, endpoint, trace ID, or request ID fields.
If you have a fresh trace ID from an endpoint response, use that first.
If traces are not visible yet, wait and retry before concluding failure.
Prefer `-o json` when the output needs to be parsed or copied into notes.

## Test Infra Notes

- Default test infra path: `/Users/israel.blancas/projects/lambda-telemetry-test-infra/serverless/main/nodejs-otel`
- Default stage: `israel`
- Default AWS profile: `Default`
- Typical layer name prefix: `israel`
- The stage may still show `UPDATE_IN_PROGRESS` while already serving traffic; for e2e, keep going until trace verification is done unless the stack is actually failing.
- Prefer overriding test infra with environment variables like `OTEL_WRAPPER_LAYER_ARN` when possible instead of mutating checked-in files.

## Branch Rules

- Core fork base: `coralogix-autoinstrumentation`
- Contrib fork base: `coralogix-autoinstrumentation`
- Main repo base: `coralogix-nodejs-autoinstrumentation`
- Core merge branch format: `merge-experimental/v<version>`
- Contrib merge branch format: `merge-instrumentation-aws-lambda-v<version>`
- Main repo bump branch format: `bump-to-latest-<version>`

## PR Rules

- Core repo PR title: `Merge <core-tag>`
- Contrib repo PR title: `Merge <contrib-tag>`
- Main repo PR title: `Merge <contrib-tag>`
- Core repo PR body: `Automated upstream merge for <core-tag>`
- Contrib repo PR body: `Automated upstream merge for <contrib-tag>`
- Main repo PR body: `bumping to experimental/v<core-version> and instrumentation-aws-lambda/<contrib-version>`
- Do not add compare-report text, extra rollout notes, or extra explanation unless the user asks.

## Files

- State: `.codex/nodejs-upstream-sync/state.env`
- Reports: `.codex/nodejs-upstream-sync/reports/`

## Notes

- Repo-local skill. Install into Codex home if the user asks.
- `full` runs build -> merge prep -> package ref sync -> rebuild -> layer deploy -> test infra deploy -> main branch create.
- `push-prs` assumes authenticated `gh`.
