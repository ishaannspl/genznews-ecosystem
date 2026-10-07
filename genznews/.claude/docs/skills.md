# Skills for genznews

32 skills in `.claude/skills/`, chosen for a Python/FastAPI scraping and LLM-writing backend. Frontend, animation, Kubernetes and cloud skills are left out because this repo has none of those (they exist in the parent `NuForm/.claude/skills/`).

| When you are... | Use |
|---|---|
| Starting any feature | `brainstorming` → `spec-driven-development` → `writing-plans` / `planning-and-task-breakdown` |
| Writing code | `test-driven-development`, `python-testing-patterns`, `python-type-safety` |
| Running a plan | `subagent-driven-development`, `using-git-worktrees` |
| Fixing a bug | `systematic-debugging`, `debugging-and-error-recovery` |
| Changing the API | `fastapi-templates`, `api-design-principles` |
| Touching scraper/LLM calls | `python-error-handling`, `python-resilience` (retries, backoff, timeouts) |
| Config and secrets | `python-configuration`, `security-and-hardening` |
| Logging and metrics | `python-observability` |
| Scheduling / queues | `python-background-jobs` |
| Database work | `sql-optimization-patterns` |
| Structure and refactors | `architecture-patterns`, `code-simplification` |
| Speed | `performance-optimization` |
| Review before merge | `requesting-code-review`, `code-review-and-quality`, agents `architect-review` / `code-reviewer` / `security-auditor`, commands `/full-review`, `/pr-enhance` |
| Quality bar | `constraint-driven-development` (write a `CONSTRAINTS.md`: Pyright 0 errors, test coverage floor) |
| Release | `shipping-and-launch` |
| Checking generated articles | `avoid-ai-writing` (detect mode) |
| Reports and docs | `docx`, `pdf` |
| Exposing the pipeline as tools | `mcp-builder` |
| Making project-specific skills | `skill-creator` |

## Highest-value first uses
1. `security-and-hardening` on the SSRF and open-API items in `known-issues.md`.
2. `test-driven-development` to add tests for `get_canonical_url`, `remove_em_dashes`, `_parse_json`.
3. `python-resilience` for the Gemini retry/fallback logic.
4. `avoid-ai-writing` on a sample of `output/**/*.md`.

## Sources
obra/superpowers, addyosmani/agent-skills, anthropics/skills, wshobson/agents (python-development, api-scaffolding, developer-essentials, avoid-ai-writing, comprehensive-review). Copied unmodified on 2026-10-05.
