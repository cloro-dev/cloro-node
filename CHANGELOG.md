# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial `Cloro` client with bearer-token auth, configurable timeout, and
  automatic retries on timeouts, connection errors, and 429/5xx.
- `client.monitor.*` — synchronous endpoints for ChatGPT, Gemini, Perplexity,
  Copilot, Grok, AI Mode, Google Search, and Google News.
- `client.asyncTasks.*` — enqueue single/batch tasks, retrieve status, queue
  status, and a `wait()` poller with interval backoff plus a `run()` convenience
  (create + wait).
- `client.countries()` / `client.states()` reference-data helpers.
- Typed exception hierarchy rooted at `CloroError`.
- Ships ESM + CommonJS builds with bundled TypeScript declarations.
