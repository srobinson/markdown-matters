#!/bin/bash
# Apply branch protection from a template
# Usage: ./apply-branch-protection.sh owner/repo template [branch]
#
# Templates: full-ci-matrix, simple, minimal, strict
#
# Examples:
#   ./apply-branch-protection.sh mdm/mdm full-ci-matrix
#   ./apply-branch-protection.sh myorg/myrepo simple main
#   ./apply-branch-protection.sh myorg/myrepo minimal develop

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_FILE="$SCRIPT_DIR/branch-protection-templates.json"

REPO="${1:?Usage: $0 owner/repo template [branch]}"
TEMPLATE="${2:?Usage: $0 owner/repo template [branch] (templates: full-ci-matrix, simple, minimal, strict)}"
BRANCH="${3:-main}"

if [[ ! -f "$TEMPLATES_FILE" ]]; then
  echo "Error: Templates file not found at $TEMPLATES_FILE"
  exit 1
fi

# Extract template (remove description field for API)
CONFIG=$(jq -r ".[\"$TEMPLATE\"] | del(.description)" "$TEMPLATES_FILE")

if [[ "$CONFIG" == "null" ]]; then
  echo "Error: Template '$TEMPLATE' not found"
  echo "Available templates:"
  jq -r 'keys[]' "$TEMPLATES_FILE"
  exit 1
fi

DESCRIPTION=$(jq -r ".[\"$TEMPLATE\"].description // \"\"" "$TEMPLATES_FILE")

echo "Applying branch protection to $REPO ($BRANCH branch)"
echo "Template: $TEMPLATE"
[[ -n "$DESCRIPTION" ]] && echo "  $DESCRIPTION"
echo ""

echo "$CONFIG" | gh api "repos/$REPO/branches/$BRANCH/protection" -X PUT --input - > /dev/null

echo "Done! Branch protection configured."
echo ""
echo "View settings: https://github.com/$REPO/settings/branches"
