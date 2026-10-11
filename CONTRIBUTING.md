# Contributing

Two of us (Quincy + Zach) work on this at the same time, so one rule keeps us from stepping on each other:

## Every change goes through a Pull Request. Nobody pushes `main` directly.

### Flow

1. **Start from fresh `main`**
   ```bash
   git checkout main && git pull origin main
   git checkout -b <you>/<short-thing>     # e.g. quincy/n8n-workflow-1, zach/booking-calendar
   ```
2. **Keep the PR small** — one feature / fix per branch. Easier to review, less to conflict.
3. **Open the PR** against `main` and fill in the template (what / why / how to test).
4. **The other person reviews and merges.** Don't merge your own PR unless the other dev has said OK in chat.
5. **After anything lands on `main`, merge `main` into your open branch** so it never drifts:
   ```bash
   git checkout <your-branch> && git merge main
   ```
6. Delete the branch after merge.

### Secrets

This repo is **public**. Never commit API keys (Anthropic, Twilio, Slack), phone numbers, or any lead/customer data. Use environment variables; commit a `.env.example` with blank values if you need to document them.

### Branch protection (repo admin — Quincy)

Turn this on once so the rule is enforced, not just agreed:

**GitHub UI:** Settings → Branches → Add branch ruleset (or classic rule) for `main` → check **Require a pull request before merging** (1 approval), **Block force pushes**, and optionally **Require conversation resolution before merging** → Save.

**Or from the terminal** (needs `gh` logged in as the repo owner):
```bash
gh api -X PUT repos/Qwill96227/Lead-Agent-/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Also recommended: Settings → General → **Automatically delete head branches** ✔.
