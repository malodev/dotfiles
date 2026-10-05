---
name: foreman-architect-web
description: Extra planning rules for apps with a web UI. Read on demand by the Architect.
tools: read
---

# Extra rules for apps with a web UI

Tests run headless and offline in a sandbox, one task at a time.

- **One process, no build step.** A small backend that also serves the frontend. Add the dependencies a task needs in that task.
- **Browser tests use Playwright Test.** Browsers are already installed: follow the Playwright version in "Facts about this machine" exactly and never download browsers. `playwright.config` starts the app itself (`webServer`) on a fixed port with a throwaway data file, so `npm test` needs no setup.
- **Test the DOM, not pixels.** Roles and labels (`getByRole`), visibility, text, empty and error states, no console errors, and layout at 375px and desktop width (no horizontal scrolling, controls inside the viewport). No screenshot comparisons.
- **Separate tasks.** API tests and UI tests are different tasks. End with an end-to-end task that walks the main flow through the real UI, including a reload to prove persistence.
- **Live preview for the owner.** Write `foreman/preview.json`: `{ "command": "node server.js", "port": 4173, "env": { "PORT": "{port}", "NOTES_FILE": "{data}/notes.json" } }`. `{port}` is the preview's port and `{data}` a private writable folder. Use a port different from the tests' port. The app must read its port and data file from those environment variables, with sensible defaults, and the task that creates the server must say so in its goal. The preview mounts the repository read-only, so the app must not write inside it.
- **Recordings.** `playwright.config` sets `outputDir: "test-results"` and `use: { video: "on", screenshot: "on", trace: "retain-on-failure" }`. Foreman keeps those files for the owner.
