#!/bin/bash
# Setup branch protection for a GitHub repository
# Usage: ./setup-branch-protection.sh owner/repo [branch]
#
# Example:
#   ./setup-branch-protection.sh mdm/mdm main
#   ./setup-branch-protection.sh myorg/myrepo

set -e

REPO="${1:?Usage: $0 owner/repo [branch]}"
BRANCH="${2:-main}"

echo "Setting up branch protection for $REPO ($BRANCH branch)..."

# Customize these status checks for your CI workflow
# Comment out or modify based on your needs
STATUS_CHECKS='[
  "quality",
  "test (ubuntu-latest, 20)",
  "test (ubuntu-latest, 22)",
  "test (macos-latest, 20)",
  "test (macos-latest, 22)",
  "test (windows-latest, 20)",
  "test (windows-latest, 22)"
]'

# For simpler projects, you might use:
# STATUS_CHECKS='["build", "test"]'

cat << EOF | gh api "repos/$REPO/branches/$BRANCH/protection" -X PUT --input -
{
  "required_status_checks": {
    "strict": true,
    "contexts": $STATUS_CHECKS
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

echo "Branch protection configured for $REPO ($BRANCH)"
echo ""
echo "Settings applied:"
echo "  - Require status checks to pass before merging"
echo "  - Require branches to be up to date before merging"
echo "  - Require 1 approving review"
echo "  - Dismiss stale reviews on new commits"
echo "  - Require linear history (no merge commits)"
echo "  - Block force pushes"
echo "  - Block branch deletion"
