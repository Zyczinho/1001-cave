# Codex instructions

## Repository workflow

Treat GitHub `origin/main` as the single source of truth.

- Run `git fetch origin` before edits and base the work on the latest `origin/main`.
- Work on a `codex/*` branch, one logical commit per task.
- Verify the result locally and commit only the intended files.
- Push with `git push -u origin HEAD` and open a pull request to `main` before handing the project back.
- Never force push. Never push `HEAD:main` without the owner's explicit approval.
- Never leave a completed change only in the Work filesystem. Push the branch before ending the session.
- If the session limit is near, push a clearly marked checkpoint branch; do not merge incomplete work.
- Do not edit the same feature concurrently with Claude Code. GitHub is the handoff layer.

## Project boundaries

- The deployable website is in `dist/`.
- The site is static HTML, CSS, and JavaScript with no build step.
- Keep `.openai/hosting.json`; it identifies the existing ChatGPT Sites project.
- Do not add a framework or dependency stack without an explicit reason and owner approval.

## Deployment

- Cloudflare Workers Builds watches `main` and runs `npx wrangler deploy` after merged changes.
- `wrangler.jsonc` publishes `dist/` as static assets; keep this path aligned with the deployable site.
- The existing ChatGPT Site is only a convenience mirror. Future delivery does not depend on ChatGPT Work.

## Product and visual rules

- Keep the page simple, restrained, and coherent.
- Preserve the black, off-white, and cyan palette.
- Use Cave Roman only for the main hero statement and Cave Sans elsewhere.
- Avoid generic template sections, decorative underlines, slashes, dashes, and unnecessary visual effects.
- Prefer strong hierarchy, whitespace, and concise copy.
- Keep the transparent logo asset intact.

## Verification

- Review changes at desktop and mobile widths.
- Check navigation, focus states, keyboard use, and reduced motion.
- Confirm all local assets load when serving `dist/` directly.
- Do not modify unrelated files or discard work already present.
