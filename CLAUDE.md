# Claude Code instructions

## Source of truth

GitHub `main` is canonical. Always run `git pull --rebase origin main` before editing and push the completed commit before ending the session.

## Architecture

- This is a deliberately simple static website.
- Production files live in `dist/`.
- There is no build step and no dependency installation.
- `.openai/hosting.json` connects the same source to the existing ChatGPT Site.
- Do not introduce a framework, package manager, or build system unless the task genuinely requires it and the owner approves the change.

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
