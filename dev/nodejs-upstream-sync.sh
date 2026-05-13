#!/bin/bash

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)
WORK_DIR="$ROOT_DIR/.codex/nodejs-upstream-sync"
REPORT_DIR="$WORK_DIR/reports"
STATE_FILE="$WORK_DIR/state.env"

CORE_REPO="${OPENTELEMETRY_JS_PATH:-$ROOT_DIR/opentelemetry-js}"
CONTRIB_REPO="${OPENTELEMETRY_JS_CONTRIB_PATH:-$ROOT_DIR/opentelemetry-js-contrib-cx}"
TEST_INFRA_DIR="${NODEJS_TEST_INFRA_PATH:-/Users/israel.blancas/projects/lambda-telemetry-test-infra/serverless/main/nodejs-otel}"

CORE_ORIGIN_URL="${CORE_ORIGIN_URL:-git@github.com:coralogix/opentelemetry-js.git}"
CORE_UPSTREAM_URL="${CORE_UPSTREAM_URL:-git@github.com:open-telemetry/opentelemetry-js.git}"
CONTRIB_ORIGIN_URL="${CONTRIB_ORIGIN_URL:-git@github.com:coralogix/opentelemetry-js-contrib.git}"
CONTRIB_UPSTREAM_URL="${CONTRIB_UPSTREAM_URL:-git@github.com:open-telemetry/opentelemetry-js-contrib.git}"

FORK_BASE_BRANCH="${FORK_BASE_BRANCH:-coralogix-autoinstrumentation}"
MAIN_BASE_BRANCH="${MAIN_BASE_BRANCH:-coralogix-nodejs-autoinstrumentation}"
MAIN_BUMP_BRANCH_PREFIX="${MAIN_BUMP_BRANCH_PREFIX:-bump-to-latest}"
TEST_STAGE="${NODEJS_TEST_STAGE:-israel}"
AWS_PROFILE="${AWS_PROFILE:-Default}"

mkdir -p "$WORK_DIR" "$REPORT_DIR"

log() {
  printf '[nodejs-sync] %s\n' "$*"
}

die() {
  printf '[nodejs-sync] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  ./dev/nodejs-upstream-sync.sh status
  ./dev/nodejs-upstream-sync.sh prepare
  ./dev/nodejs-upstream-sync.sh sync-package-refs
  ./dev/nodejs-upstream-sync.sh build
  ./dev/nodejs-upstream-sync.sh deploy-layer
  ./dev/nodejs-upstream-sync.sh update-test-infra <layer-arn>
  ./dev/nodejs-upstream-sync.sh deploy-test-infra
  ./dev/nodejs-upstream-sync.sh create-main-branch
  ./dev/nodejs-upstream-sync.sh push-prs
  ./dev/nodejs-upstream-sync.sh full

Commands:
  status            Fetch forks/upstreams. Detect newest unmerged upstream tags.
                    Write compare reports and state file.
  prepare           Run status. Create merge branches. Merge target tags into both forks.
                    Stops on conflicts and prints unresolved files.
  sync-package-refs Update nodejs/package.json file tgz references from fork package versions.
  build             Run ./dev/build-nodejs.sh.
  deploy-layer      Run ./dev/deploy-nodejs.sh. Retry once after aws sso login on auth failure.
  update-test-infra Replace layer reference in test infra serverless.yml.
  deploy-test-infra Run sls deploy --stage "$NODEJS_TEST_STAGE" in test infra repo.
  create-main-branch
                    Create or switch root repo branch for PR work.
  push-prs          Push current fork branches. Create PRs with gh.
  full              Run build, status, prepare, sync-package-refs, build, deploy-layer.
                    If LAYER_ARN returned, update/deploy test infra too.

Generated artifacts:
  .codex/nodejs-upstream-sync/state.env
  .codex/nodejs-upstream-sync/reports/*

Environment overrides:
  OPENTELEMETRY_JS_PATH
  OPENTELEMETRY_JS_CONTRIB_PATH
  NODEJS_TEST_INFRA_PATH
  NODEJS_TEST_STAGE
  LAMBDA_LAYER_PREFIX
  AWS_PROFILE
  MAIN_BUMP_BRANCH_PREFIX
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

sanitize_branch_name() {
  printf '%s' "$1" | tr '/' '-'
}

version_sort_last() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  printf '%s\n' "$@" | awk 'NF' | sort -V | tail -1
}

tags_after() {
  local repo="$1"
  local pattern="$2"
  local merged_tag="${3:-}"
  local seen=0 tag
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    if [ -z "$merged_tag" ]; then
      printf '%s\n' "$tag"
      continue
    fi
    if [ "$seen" -eq 1 ]; then
      printf '%s\n' "$tag"
    fi
    if [ "$tag" = "$merged_tag" ]; then
      seen=1
    fi
  done < <(git -C "$repo" tag --list "$pattern" | sort -V)
}

ensure_repo() {
  local path="$1"
  local origin_url="$2"
  local branch="$3"
  if [ -d "$path/.git" ]; then
    return 0
  fi
  log "Cloning $(basename "$path")"
  git clone "$origin_url" "$path" -b "$branch"
}

ensure_remote() {
  local repo="$1"
  local remote_name="$2"
  local remote_url="$3"
  if git -C "$repo" remote get-url "$remote_name" >/dev/null 2>&1; then
    return 0
  fi
  log "Adding remote $remote_name in $(basename "$repo")"
  git -C "$repo" remote add "$remote_name" "$remote_url"
}

fetch_repo() {
  local repo="$1"
  log "Fetching $(basename "$repo")"
  git -C "$repo" fetch origin --tags
  git -C "$repo" fetch upstream --tags
}

latest_tag() {
  local repo="$1"
  local pattern="$2"
  git -C "$repo" tag --list "$pattern" | sort -V | tail -1
}

latest_merged_tag() {
  local repo="$1"
  local branch="$2"
  local pattern="$3"
  git -C "$repo" tag --merged "$branch" --list "$pattern" | sort -V | tail -1
}

write_compare_report() {
  local repo="$1"
  local branch="$2"
  local tag="$3"
  local prefix="$4"
  local summary="$REPORT_DIR/${prefix}-summary.txt"
  local diff_file="$REPORT_DIR/${prefix}-diff.patch"
  local files_file="$REPORT_DIR/${prefix}-files.txt"
  {
    printf 'repo=%s\n' "$repo"
    printf 'branch=%s\n' "$branch"
    printf 'tag=%s\n\n' "$tag"
    printf 'Unique commits on branch:\n'
    git -C "$repo" log --left-right --cherry-pick --oneline "$tag...$branch" | sed -n 's/^>//p'
  } >"$summary"
  git -C "$repo" diff "$tag..$branch" >"$diff_file"
  git -C "$repo" diff --name-status "$tag..$branch" >"$files_file"
}

save_state() {
  cat >"$STATE_FILE" <<EOF
CORE_REPO=$CORE_REPO
CONTRIB_REPO=$CONTRIB_REPO
FORK_BASE_BRANCH=$FORK_BASE_BRANCH
MAIN_BASE_BRANCH=$MAIN_BASE_BRANCH
CORE_LATEST_TAG=$CORE_LATEST_TAG
CORE_MERGED_TAG=$CORE_MERGED_TAG
CORE_TARGET_TAG=$CORE_TARGET_TAG
CORE_MERGE_BRANCH=$CORE_MERGE_BRANCH
CONTRIB_LATEST_TAG=$CONTRIB_LATEST_TAG
CONTRIB_MERGED_TAG=$CONTRIB_MERGED_TAG
CONTRIB_TARGET_TAG=$CONTRIB_TARGET_TAG
CONTRIB_MERGE_BRANCH=$CONTRIB_MERGE_BRANCH
MAIN_BUMP_BRANCH=$MAIN_BUMP_BRANCH
EOF
}

load_state() {
  [ -f "$STATE_FILE" ] || die "Missing state file. Run: ./dev/nodejs-upstream-sync.sh status"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
}

detect_targets() {
  ensure_repo "$CORE_REPO" "$CORE_ORIGIN_URL" "$FORK_BASE_BRANCH"
  ensure_repo "$CONTRIB_REPO" "$CONTRIB_ORIGIN_URL" "$FORK_BASE_BRANCH"
  ensure_remote "$CORE_REPO" upstream "$CORE_UPSTREAM_URL"
  ensure_remote "$CONTRIB_REPO" upstream "$CONTRIB_UPSTREAM_URL"
  fetch_repo "$CORE_REPO"
  fetch_repo "$CONTRIB_REPO"

  CORE_LATEST_TAG=$(latest_tag "$CORE_REPO" 'experimental/v*')
  CORE_MERGED_TAG=$(latest_merged_tag "$CORE_REPO" "$FORK_BASE_BRANCH" 'experimental/v*')
  CORE_TARGET_TAG=$(tags_after "$CORE_REPO" 'experimental/v*' "$CORE_MERGED_TAG" | head -1 || true)
  local target_label=""
  if [ -n "$CORE_TARGET_TAG" ]; then
    target_label="${CORE_TARGET_TAG#experimental/v}"
  fi

  CONTRIB_LATEST_TAG=$(latest_tag "$CONTRIB_REPO" 'instrumentation-aws-lambda-v*')
  CONTRIB_MERGED_TAG=$(latest_merged_tag "$CONTRIB_REPO" "$FORK_BASE_BRANCH" 'instrumentation-aws-lambda-v*')
  CONTRIB_TARGET_TAG=$(tags_after "$CONTRIB_REPO" 'instrumentation-aws-lambda-v*' "$CONTRIB_MERGED_TAG" | head -1 || true)
  if [ -z "$target_label" ] && [ -n "$CONTRIB_TARGET_TAG" ]; then
    target_label="${CONTRIB_TARGET_TAG#instrumentation-aws-lambda-v}"
  fi

  CORE_MERGE_BRANCH=""
  if [ -n "$CORE_TARGET_TAG" ]; then
    CORE_MERGE_BRANCH="merge-${CORE_TARGET_TAG}"
  fi
  CONTRIB_MERGE_BRANCH=""
  if [ -n "$CONTRIB_TARGET_TAG" ]; then
    CONTRIB_MERGE_BRANCH="merge-${CONTRIB_TARGET_TAG}"
  fi
  MAIN_BUMP_BRANCH="$MAIN_BUMP_BRANCH_PREFIX"
  if [ -n "$target_label" ]; then
    MAIN_BUMP_BRANCH="${MAIN_BUMP_BRANCH_PREFIX}-${target_label}"
  fi

  if [ -n "$CORE_MERGED_TAG" ]; then
    write_compare_report "$CORE_REPO" "$FORK_BASE_BRANCH" "$CORE_MERGED_TAG" core
  fi
  if [ -n "$CONTRIB_MERGED_TAG" ]; then
    write_compare_report "$CONTRIB_REPO" "$FORK_BASE_BRANCH" "$CONTRIB_MERGED_TAG" contrib
  fi

  save_state
}

print_status() {
  log "Core merged tag:   ${CORE_MERGED_TAG:-<none>}"
  log "Core latest tag:   ${CORE_LATEST_TAG:-<none>}"
  log "Core target tag:   ${CORE_TARGET_TAG:-<none>}"
  log "Contrib merged tag:${CONTRIB_MERGED_TAG:-<none>}"
  log "Contrib latest tag:${CONTRIB_LATEST_TAG:-<none>}"
  log "Contrib target tag:${CONTRIB_TARGET_TAG:-<none>}"
  log "Core report:       $REPORT_DIR/core-summary.txt"
  log "Contrib report:    $REPORT_DIR/contrib-summary.txt"
  if [ -z "${CORE_TARGET_TAG:-}" ] && [ -z "${CONTRIB_TARGET_TAG:-}" ]; then
    log "No new upstream tags. Stop."
  fi
}

checkout_tracking_branch() {
  local repo="$1"
  local branch="$2"
  git -C "$repo" fetch origin "$branch"
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$repo" checkout "$branch"
  else
    git -C "$repo" checkout -b "$branch" "origin/$branch"
  fi
  git -C "$repo" pull --ff-only origin "$branch"
}

prepare_merge_branch() {
  local repo="$1"
  local base_branch="$2"
  local merge_branch="$3"
  checkout_tracking_branch "$repo" "$base_branch"
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$merge_branch"; then
    git -C "$repo" checkout "$merge_branch"
  else
    git -C "$repo" checkout -b "$merge_branch"
  fi
}

run_merge() {
  local repo="$1"
  local tag="$2"
  local message="Merge tag '$tag' into $FORK_BASE_BRANCH"
  if git -C "$repo" -c commit.gpgsign=false merge --no-ff "$tag" -m "$message"; then
    log "Merged $tag in $(basename "$repo")"
    return 0
  fi

  local unresolved=""
  unresolved=$(git -C "$repo" diff --name-only --diff-filter=U || true)
  if [ -n "$unresolved" ]; then
    printf '%s\n' "$unresolved" >"$REPORT_DIR/$(basename "$repo")-conflicts.txt"
    die "Merge conflicts in $(basename "$repo"). Resolve files listed in $REPORT_DIR/$(basename "$repo")-conflicts.txt"
  fi
  die "Merge failed in $(basename "$repo")"
}

sync_package_refs() {
  require_cmd node
  local core_version contrib_lambda_version contrib_mongodb_version contrib_aws_sdk_version
  local core_tgz contrib_lambda_tgz contrib_mongodb_tgz contrib_aws_sdk_tgz
  core_version=$(node -p "require('$CORE_REPO/experimental/packages/opentelemetry-instrumentation/package.json').version")
  contrib_lambda_version=$(node -p "require('$CONTRIB_REPO/packages/instrumentation-aws-lambda/package.json').version")
  contrib_mongodb_version=$(node -p "require('$CONTRIB_REPO/packages/instrumentation-mongodb/package.json').version")
  contrib_aws_sdk_version=$(node -p "require('$CONTRIB_REPO/packages/instrumentation-aws-sdk/package.json').version")
  core_tgz="$CORE_REPO/experimental/packages/opentelemetry-instrumentation/opentelemetry-instrumentation-${core_version}.tgz"
  contrib_lambda_tgz="$CONTRIB_REPO/packages/instrumentation-aws-lambda/opentelemetry-instrumentation-aws-lambda-${contrib_lambda_version}.tgz"
  contrib_mongodb_tgz="$CONTRIB_REPO/packages/instrumentation-mongodb/opentelemetry-instrumentation-mongodb-${contrib_mongodb_version}.tgz"
  contrib_aws_sdk_tgz="$CONTRIB_REPO/packages/instrumentation-aws-sdk/opentelemetry-instrumentation-aws-sdk-${contrib_aws_sdk_version}.tgz"

  CORE_TGZ="$core_tgz" \
  CONTRIB_LAMBDA_TGZ="$contrib_lambda_tgz" \
  CONTRIB_MONGODB_TGZ="$contrib_mongodb_tgz" \
  CONTRIB_AWS_SDK_TGZ="$contrib_aws_sdk_tgz" \
  node <<'EOF'
const fs = require('fs');
const path = require('path');

function asFileRef(pkgFile, targetFile) {
  const normalized = targetFile.replace(/\\/g, '/');
  if (normalized.includes('/experimental/packages/opentelemetry-instrumentation/')) {
    const filename = path.basename(normalized);
    return `file:../../../opentelemetry-js/experimental/packages/opentelemetry-instrumentation/${filename}`;
  }
  if (normalized.includes('/packages/instrumentation-aws-lambda/')) {
    const filename = path.basename(normalized);
    return `file:../../../opentelemetry-js-contrib-cx/packages/instrumentation-aws-lambda/${filename}`;
  }
  if (normalized.includes('/packages/instrumentation-aws-sdk/')) {
    const filename = path.basename(normalized);
    return `file:../../../opentelemetry-js-contrib-cx/packages/instrumentation-aws-sdk/${filename}`;
  }
  if (normalized.includes('/packages/instrumentation-mongodb/')) {
    const filename = path.basename(normalized);
    return `file:../../../opentelemetry-js-contrib-cx/packages/instrumentation-mongodb/${filename}`;
  }
  const pkgDir = path.dirname(path.resolve(pkgFile));
  return `file:${path.relative(pkgDir, path.resolve(targetFile))}`;
}

const updates = {
  "nodejs/packages/cx-wrapper/package.json": {
    "@opentelemetry/instrumentation": asFileRef("nodejs/packages/cx-wrapper/package.json", process.env.CORE_TGZ),
    "@opentelemetry/instrumentation-aws-lambda": asFileRef("nodejs/packages/cx-wrapper/package.json", process.env.CONTRIB_LAMBDA_TGZ),
    "@opentelemetry/instrumentation-aws-sdk": asFileRef("nodejs/packages/cx-wrapper/package.json", process.env.CONTRIB_AWS_SDK_TGZ),
    "@opentelemetry/instrumentation-mongodb": asFileRef("nodejs/packages/cx-wrapper/package.json", process.env.CONTRIB_MONGODB_TGZ)
  },
  "nodejs/packages/layer/package.json": {
    "@opentelemetry/instrumentation": asFileRef("nodejs/packages/layer/package.json", process.env.CORE_TGZ),
    "@opentelemetry/instrumentation-aws-lambda": asFileRef("nodejs/packages/layer/package.json", process.env.CONTRIB_LAMBDA_TGZ),
    "@opentelemetry/instrumentation-aws-sdk": asFileRef("nodejs/packages/layer/package.json", process.env.CONTRIB_AWS_SDK_TGZ),
    "@opentelemetry/instrumentation-mongodb": asFileRef("nodejs/packages/layer/package.json", process.env.CONTRIB_MONGODB_TGZ)
  }
};

for (const [file, deps] of Object.entries(updates)) {
  const raw = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.dependencies = { ...pkg.dependencies, ...deps };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
EOF
  log "Updated nodejs package tgz references"
}

build_layer() {
  "$ROOT_DIR/dev/build-nodejs.sh"
}

deploy_layer() {
  require_cmd aws
  local output rc
  set +e
  output=$(AWS_PROFILE="$AWS_PROFILE" "$ROOT_DIR/dev/deploy-nodejs.sh" 2>&1)
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$output" | grep -Eiq 'sso|token|expired|unauthorized|auth'; then
      log "AWS auth failed. Running aws sso login --profile $AWS_PROFILE"
      aws sso login --profile "$AWS_PROFILE"
      output=$(AWS_PROFILE="$AWS_PROFILE" "$ROOT_DIR/dev/deploy-nodejs.sh")
    else
      printf '%s\n' "$output" >&2
      die "Layer deploy failed"
    fi
  fi
  LAYER_ARN=$(printf '%s\n' "$output" | tail -1)
  log "Layer ARN: $LAYER_ARN"
}

update_test_infra() {
  local layer_arn="$1"
  local file="$TEST_INFRA_DIR/serverless.yml"
  [ -f "$file" ] || die "Missing test infra file: $file"
  LAYER_ARN="$layer_arn" perl -0pi -e 'my $layer = $ENV{LAYER_ARN}; s{\$\{env:OTEL_WRAPPER_LAYER_ARN,\s*'\''[^'\'']+'\''\}}{\${env:OTEL_WRAPPER_LAYER_ARN, '\''$layer'\''}}g' "$file"
  log "Updated test infra layer reference in $file"
}

deploy_test_infra() {
  require_cmd sls
  (cd "$TEST_INFRA_DIR" && sls deploy --stage "$TEST_STAGE")
}

create_main_branch() {
  git fetch origin "$MAIN_BASE_BRANCH"
  if git show-ref --verify --quiet "refs/heads/$MAIN_BUMP_BRANCH"; then
    git checkout "$MAIN_BUMP_BRANCH"
  else
    git checkout -b "$MAIN_BUMP_BRANCH" "origin/$MAIN_BASE_BRANCH"
  fi
}

push_repo_branch() {
  local repo="$1"
  local branch="$2"
  git -C "$repo" push -u origin "$branch"
}

create_pr() {
  local repo_dir="$1"
  local base_branch="$2"
  local head_branch="$3"
  local title="$4"
  local body="$5"
  (cd "$repo_dir" && gh pr create --base "$base_branch" --head "$head_branch" --title "$title" --body "$body")
}

push_prs() {
  require_cmd gh
  load_state
  [ -n "${CORE_MERGE_BRANCH:-}" ] || die "No merge branch in state"
  [ -n "${CONTRIB_MERGE_BRANCH:-}" ] || die "No contrib merge branch in state"
  [ -n "${MAIN_BUMP_BRANCH:-}" ] || die "No main bump branch in state"

  push_repo_branch "$CORE_REPO" "$CORE_MERGE_BRANCH"
  push_repo_branch "$CONTRIB_REPO" "$CONTRIB_MERGE_BRANCH"
  git push -u origin "$MAIN_BUMP_BRANCH"

  create_pr "$CORE_REPO" "$FORK_BASE_BRANCH" "$CORE_MERGE_BRANCH" \
    "Merge ${CORE_TARGET_TAG} into ${FORK_BASE_BRANCH}" \
    "Automated upstream merge for ${CORE_TARGET_TAG}. Compare reports: .codex/nodejs-upstream-sync/reports/core-summary.txt"
  create_pr "$CONTRIB_REPO" "$FORK_BASE_BRANCH" "$CONTRIB_MERGE_BRANCH" \
    "Merge ${CONTRIB_TARGET_TAG} into ${FORK_BASE_BRANCH}" \
    "Automated upstream merge for ${CONTRIB_TARGET_TAG}. Compare reports: .codex/nodejs-upstream-sync/reports/contrib-summary.txt"
  create_pr "$ROOT_DIR" "$MAIN_BASE_BRANCH" "$MAIN_BUMP_BRANCH" \
    "Bump Node.js layer to ${CORE_TARGET_TAG}" \
    "Automated Node.js layer refresh for ${CORE_TARGET_TAG} / ${CONTRIB_TARGET_TAG}."
}

cmd_status() {
  detect_targets
  print_status
}

cmd_prepare() {
  detect_targets
  print_status
  [ -n "${CORE_TARGET_TAG:-}" ] || [ -n "${CONTRIB_TARGET_TAG:-}" ] || return 0
  if [ -n "${CORE_TARGET_TAG:-}" ]; then
    prepare_merge_branch "$CORE_REPO" "$FORK_BASE_BRANCH" "$CORE_MERGE_BRANCH"
    run_merge "$CORE_REPO" "$CORE_TARGET_TAG"
  fi
  if [ -n "${CONTRIB_TARGET_TAG:-}" ]; then
    prepare_merge_branch "$CONTRIB_REPO" "$FORK_BASE_BRANCH" "$CONTRIB_MERGE_BRANCH"
    run_merge "$CONTRIB_REPO" "$CONTRIB_TARGET_TAG"
  fi
}

cmd_full() {
  build_layer
  cmd_prepare
  [ -n "${CORE_TARGET_TAG:-}" ] || [ -n "${CONTRIB_TARGET_TAG:-}" ] || return 0
  sync_package_refs
  build_layer
  deploy_layer
  if [ -n "${LAYER_ARN:-}" ] && [ -d "$TEST_INFRA_DIR" ]; then
    update_test_infra "$LAYER_ARN"
    deploy_test_infra
  fi
  create_main_branch
}

main() {
  require_cmd git
  require_cmd sort
  require_cmd perl
  local cmd="${1:-}"
  case "$cmd" in
    status)
      cmd_status
      ;;
    prepare)
      cmd_prepare
      ;;
    sync-package-refs)
      sync_package_refs
      ;;
    build)
      build_layer
      ;;
    deploy-layer)
      deploy_layer
      ;;
    update-test-infra)
      [ $# -eq 2 ] || die "Usage: ./dev/nodejs-upstream-sync.sh update-test-infra <layer-arn>"
      update_test_infra "$2"
      ;;
    deploy-test-infra)
      deploy_test_infra
      ;;
    create-main-branch)
      load_state
      create_main_branch
      ;;
    push-prs)
      push_prs
      ;;
    full)
      cmd_full
      ;;
    ""|-h|--help|help)
      usage
      ;;
    *)
      die "Unknown command: $cmd"
      ;;
  esac
}

main "$@"
