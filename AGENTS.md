# Codex instructions

## Repository workflow

Treat GitHub `main` as the canonical version. Pull with rebase before edits, verify the result locally, commit only the intended files, and push before handing the project back.

## Project boundaries

- The deployable website is in `dist/`.
- The site is static HTML, CSS, and JavaScript with no build step.
- Keep `.openai/hosting.json`; it identifies the existing ChatGPT Sites project.
- Do not add a framework or dependency stack without an explicit reason and owner approval.

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
