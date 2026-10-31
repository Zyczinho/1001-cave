# 1001 CAVE

An independent product studio for small, concrete tools that solve everyday problems.

This repository is the canonical source for the 1001 CAVE website. Work done in Claude Code, Codex, or another editor should begin from the latest `main` branch and end with a committed, pushed change.

## Current version

- Website: static HTML, CSS, and JavaScript
- Status: private MVP, version 0.4
- Sections: Home, Foundation, Products, Contact
- First product in development: JAKUB

## Structure

```text
.
├── .openai/hosting.json   # ChatGPT Sites hosting configuration
├── dist/
│   ├── assets/            # Logo and local fonts
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── AGENTS.md              # Instructions for Codex
├── CLAUDE.md              # Instructions for Claude Code
└── README.md
```

## Run locally

No build step or package installation is required.

```bash
python3 -m http.server 4173 --directory dist
```

Open [http://localhost:4173](http://localhost:4173).

On Windows, if `python3` is unavailable:

```powershell
py -m http.server 4173 --directory dist
```

## Working rule

Use GitHub `main` as the single source of truth.

1. Pull before editing: `git pull --rebase origin main`
2. Make and test one coherent change.
3. Commit it with a clear message.
4. Push it: `git push origin main`

Avoid editing the project concurrently in two tools. Finish and push one session before opening the next.

## Deployment

The current ChatGPT Site reads the static files from `dist/`. Publishing the Site and pushing this repository are separate operations, so every published change must also be committed here.

## Brand guardrails

- Keep the experience minimal, calm, and deliberate.
- Use the existing black, off-white, and cyan palette.
- Use Cave Roman only for the main hero statement and Cave Sans elsewhere.
- Avoid decorative underlines, slashes, dashes, generic gradients, and template-like layouts.
- Prefer fewer elements and clearer spacing over adding components.

Private project. All rights reserved.
