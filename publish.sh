#!/usr/bin/env bash
set -euo pipefail

# publish.sh — build, test, version, and publish the package to npm.
# Run from anywhere; it operates on the repo root.
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
publish.sh — build, test, version, and publish @icjia/pagecount

Usage:
  ./publish.sh --dry-run           Build, test, and preview the package (no bump, no publish)
  ./publish.sh patch               Bump patch version, then publish
  ./publish.sh minor               Bump minor version, then publish
  ./publish.sh major               Bump major version, then publish
  ./publish.sh 1.4.2               Set an explicit version, then publish
  ./publish.sh patch --dry-run     Run the full flow but stop before bump/publish
  ./publish.sh -h | --help         Show this help

Notes:
  - Always runs typecheck + tests + build before anything is published.
  - A real publish requires a clean git working tree; it bumps the version
    (creating a git commit + tag), publishes with public access, and pushes
    the commit and tags.
EOF
}

DRY_RUN=false
BUMP=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "Unknown flag: $arg" >&2; usage; exit 1 ;;
    *) BUMP="$arg" ;; # patch|minor|major|<version> — npm version validates it
  esac
done

if ! $DRY_RUN && [ -z "$BUMP" ]; then
  echo "Error: specify patch|minor|major|<version>, or --dry-run." >&2
  usage
  exit 1
fi

echo "==> Installing dependencies"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

echo "==> Type-checking"
npm run typecheck

echo "==> Running tests"
npm test

echo "==> Building"
npm run build

if $DRY_RUN; then
  echo "==> Previewing package contents (dry run)"
  npm publish --dry-run --access public
  echo "Dry run complete — nothing was published and no version was changed."
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

echo "==> Bumping version: $BUMP"
npm version "$BUMP" -m "release: v%s"

echo "==> Publishing to npm"
npm publish --access public

echo "==> Pushing commit and tags"
git push --follow-tags

echo "Published $(node -p "require('./package.json').version") 🎉"
