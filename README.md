# 1001 CAVE

An independent product studio for small, concrete tools that solve everyday problems.

This repository is the canonical source for the 1001 CAVE website. Work done in Claude Code, Codex, or another editor should begin from the latest `origin/main` and end with a pushed branch and a pull request to `main`.

## Current version

- Website: static HTML, CSS, and JavaScript
- Status: private MVP, version 0.5
- Sections: Home, Foundation, Our Products, Contact
- First product in development: physical NFC commitment object (name in progress)

## Structure

```text
.
├── .openai/hosting.json   # ChatGPT Sites hosting configuration
├── dist/
│   ├── assets/
│   │   ├── logo-1001-cave-transparent.png
│   │   ├── logo-1001-cave.png
│   │   └── *.otf          # Local fonts
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── wrangler.jsonc          # Cloudflare Workers static-assets configuration
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

GitHub `origin/main` is the single source of truth. Changes reach it through pull requests.

1. Fetch before editing: `git fetch origin`
2. Work on a `claude/*` or `codex/*` branch based on the latest `origin/main`.
3. Make and test one coherent change, committed as one logical commit.
4. Push the branch: `git push -u origin HEAD`
5. Open a pull request to `main`.

Never force push. Do not push directly to `main` (`HEAD:main`) without the owner's explicit approval.

Avoid editing the project concurrently in two tools. Finish and push one session before opening the next.

## Continuity between agents

- GitHub is the handoff layer. Never treat a ChatGPT Work workspace, a Claude session or one computer as the only copy of finished work.
- Before ending a session, push every coherent change. If time is running out, push a clearly named checkpoint branch and state that it is not ready to merge.
- The next agent starts from the newest `origin/main`, or from the named checkpoint branch when continuing unfinished work.

## Deployment

Cloudflare Workers Builds is the independent production path. `wrangler.jsonc` publishes `dist/` as static assets. Cloudflare watches `main` and runs `npx wrangler deploy` automatically after every merged change; no build command is required.

The existing ChatGPT Site can remain as a convenience mirror, but GitHub is the canonical source and future publishing does not depend on ChatGPT Work.

## Brand guardrails

- Keep the experience minimal, calm, and deliberate.
- Use the existing black, off-white, and cyan palette.
- Use Cave Roman only for the main hero statement and Cave Sans elsewhere.
- Avoid decorative underlines, slashes, dashes, generic gradients, and template-like layouts.
- Prefer fewer elements and clearer spacing over adding components.

Private project. All rights reserved.
