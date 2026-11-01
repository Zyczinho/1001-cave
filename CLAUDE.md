# Claude Code instructions

## Source of truth

GitHub `origin/main` is the single source of truth.

- Run `git fetch origin` before editing and make sure the branch is based on the latest `origin/main`.
- Work on a `claude/*` branch, one logical commit per task.
- Push with `git push -u origin HEAD` and open a pull request to `main`.
- Never force push. Never push `HEAD:main` without the owner's explicit approval.
- Never leave a completed change only on the local computer. Push the branch before ending the session.
- If the session limit is near, push a clearly marked checkpoint branch; do not merge incomplete work.
- Do not edit the same feature concurrently with Codex. GitHub is the handoff layer.

## Architecture

- This is a deliberately simple static website.
- Production files live in `dist/`.
- There is no build step and no dependency installation.
- `.openai/hosting.json` connects the same source to the existing ChatGPT Site.
- Do not introduce a framework, package manager, or build system unless the task genuinely requires it and the owner approves the change.

## Deployment

- `.github/workflows/deploy-pages.yml` deploys `dist/` after updates reach `main`.
- GitHub Pages is the independent deployment path and needs one-time enablement in repository settings.
- The existing ChatGPT Site is only a convenience mirror. Future delivery must not depend on ChatGPT Work.

## Design direction

- Minimal, editorial, precise, and easy to navigate.
- Existing palette: black, off-white, and cyan.
- Cave Roman is reserved for the main hero statement.
- Cave Sans is used everywhere else.
- Avoid decorative underlines, slashes, dashes, generic gradients, excessive cards, and familiar AI-template layouts.
- Preserve the transparent logo asset and its proportions.
- Keep copy concise and human.

## Change discipline

- Read the existing HTML, CSS, and JavaScript before changing them.
- Preserve accessibility, responsive behavior, and reduced-motion support.
- Reuse the existing design system before adding new styles.
- Do not overwrite unrelated work.
- Preview the site locally after visual changes.
- Keep each commit focused and explain the visible outcome in the commit message.
