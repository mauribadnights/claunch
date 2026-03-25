# claunch — Project Rules

## npm Publishing

**Before bumping version or publishing:** always run `npm view @mauribadnights/claunch versions --json` to check what's already published. Never guess the current version — the local package.json may be behind the registry. Bump from the highest published version, not from what's in the file.
