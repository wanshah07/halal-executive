#!/usr/bin/env bash
# Move this folder into its own repository, keeping history.
#   1. Create the empty repo on GitHub: wanshah07/halal-executive (no README).
#   2. From the root of malaysian-regulatory-affairs on the branch that holds
#      halal-executive/, run:  bash halal-executive/scripts/split-to-own-repo.sh
set -euo pipefail
REMOTE="${1:-git@github.com:wanshah07/halal-executive.git}"
root=$(git rev-parse --show-toplevel)
cd "$root"
git subtree split --prefix=halal-executive -b halal-executive-split
tmp=$(mktemp -d)
git clone -q "$root" -b halal-executive-split "$tmp/halal-executive"
cd "$tmp/halal-executive"
git branch -m main
git remote set-url origin "$REMOTE"
git push -u origin main
echo "Pushed to $REMOTE. Now: Settings → Pages → Source: GitHub Actions; add secrets per SETUP.md;"
echo "then delete halal-executive/ from malaysian-regulatory-affairs in a follow-up commit."
