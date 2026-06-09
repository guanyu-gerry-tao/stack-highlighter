# Stack Highlighter

Current version: `0.2.1`

Stack Highlighter is a small unpacked Chrome extension for job-search reading. It highlights useful terms on the current page and lets you manage keyword bubbles from a right-side Chrome side panel.

## What It Does

- Highlights page keywords by category.
- Opens a right-side panel from the extension button.
- Lists keywords as compact color-coded bubbles.
- Puts red flags first and starts every category collapsed.
- Expands or collapses a category by clicking its header area, while `+` still only adds keywords.
- Shows only current-page hits while a category is collapsed; header-only when that category has no page hits.
- Adds keywords from each category header.
- Deletes a keyword from the bubble hover `x`.
- Reorders categories with up/down controls.
- Searches keywords from the top search box.
- Shows short page selections in the panel without changing the current keyword filters.
- Adds selected text through the small `+` button on the chosen category header.
- Uses greedy longest matching, so `React Native` wins over `React` on the page.
- Allows simple plural suffixes, so a `database` keyword can match `databases` while only highlighting the keyword body.
- Colors keywords found on the current page and fades keywords that are in the library but not present on the page.
- Exports and imports the keyword table as JSON.

## Categories

- `Hard Skills`: Python, Java, Go, SQL, Git, Linux, React, AWS, Azure, GCP, Docker, Kubernetes, RAG, LangGraph, and similar technical stack terms.
- `Patterns`: Agile, SDLC, CI/CD, system design, testing, data pipelines, distributed systems, and similar workflow or architecture patterns.
- `Soft Skills`: Self Motivated, Ownership, Collaboration, Communication, Teamwork, and similar human signals.
- `Red Flags`: GC, Green Card, sponsorship, citizen, clearance, and similar terms that deserve careful reading. These are warning signals, not automatic rejection rules.
- `Other Keywords`: Intern, 2026, 2027, Summer, New Grad, and useful context terms.

## Install In Chrome

Stack Highlighter is an unpacked Chrome extension, so it does not need to be published to the Chrome Web Store.

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on `Developer mode` in the top-right corner.
4. Click `Load unpacked`.
5. Select the local `stack-highlighter` folder. Select the folder that contains `manifest.json`, not the `src` folder.
6. Open a job page and click the Stack Highlighter extension icon.

If the icon is hidden, open Chrome's extensions menu and pin `Stack Highlighter` to the toolbar.

After changing local files, go back to `chrome://extensions` and click the reload button on the Stack Highlighter card. Then refresh the job page so the content script reloads too.

## Privacy And Permissions

Stack Highlighter is local-first. Keyword data and enabled/disabled state are stored in Chrome extension storage. The extension does not send job-page text or keyword data to a server.

The manifest uses broad page access so the content script can highlight keywords on arbitrary job pages. This project is intended for local unpacked use, not Chrome Web Store distribution.

## Development

This project intentionally has no build step. Chrome loads the files directly:

- `manifest.json`: Chrome MV3 configuration.
- `sidepanel.html`: right panel entrypoint.
- `src/sidepanel.js`: keyword management UI.
- `src/contentScript.js`: page selection capture and highlighting.
- `src/shared.js`: keyword defaults, cleaning, filtering, and matching helpers.
- `src/content.css`: highlight styles injected into web pages.
- `src/sidepanel.css`: panel visual design.

Run the lightweight checks with:

```bash
node tests/shared.test.js
node --check src/shared.js
node --check src/contentScript.js
node --check src/sidepanel.js
node --check src/background.js
```
