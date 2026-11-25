# End-to-End Testing

This directory contains Playwright-based end-to-end tests for the HyperDX
application. The tests are organized into core functionality and
feature-specific test suites.

## Prerequisites

- Node.js (>=22.16.0 as specified in package.json)
- Dependencies installed via `yarn install`
- Development server running (automatically handled by test configuration)

## Running Tests

### Default: Full-Stack Mode

By default, `make e2e` runs tests in **full-stack mode** with DocumentDB + API +
local Docker ClickHouse for maximum consistency and real backend features:

```bash
# Run all tests (full-stack with DocumentDB + API + local Docker ClickHouse)
make e2e

# For UI, specific tests, or other options, use the script from repo root:
./scripts/test-e2e.sh --ui                 # Run with Playwright UI
./scripts/test-e2e.sh --grep "@kubernetes"  # Run specific tests
./scripts/test-e2e.sh --grep "@smoke"
./scripts/test-e2e.sh --ui --last-failed   # Re-run only failed tests with UI
```

### Optional: Local Mode (Frontend Only)

For faster iteration during development, use the script with `--local` to skip
DocumentDB and run frontend-only tests:

```bash
# From repo root - run local tests (no DocumentDB, frontend only)
./scripts/test-e2e.sh --local
./scripts/test-e2e.sh --local --ui
./scripts/test-e2e.sh --local --grep "@search"

# From packages/app - run local tests (frontend only)
cd packages/app
yarn test:e2e --local
```

**When to use local mode:**

- Quick frontend iteration during development
- Testing UI components that don't need auth/persistence
- Faster test execution when you don't need backend features

### Direct Command Usage

From `packages/app`, you can use the `test:e2e` command with flags:

```bash
# Full-stack mode (default, with backend)
yarn test:e2e

# Local mode (frontend only)
yarn test:e2e --local

# Combine with other flags
yarn test:e2e --ui                    # UI mode (full-stack)
yarn test:e2e --ui --local            # UI mode (local)
yarn test:e2e --debug                 # Debug mode (full-stack)
yarn test:e2e --debug --local         # Debug mode (local)
yarn test:e2e --headed                # Visible browser (full-stack)
yarn test:e2e --headed --local        # Visible browser (local)

# Run specific test with any mode
yarn test:e2e tests/e2e/features/search/search.spec.ts
yarn test:e2e tests/e2e/features/dashboard.spec.ts --local
```

**Watch mode (re-run on file save):**

Playwright UI has built-in watch. Run with UI, then enable it per test:

```bash
./scripts/test-e2e.sh --keep-running --ui
```

In the Playwright UI sidebar, click the **eye icon** next to a test (or file/describe) to turn on watch for it. When you save changes to that test file, that test will re-run automatically.

**Available flags:**

- `--local` - Run in local mode (frontend only), excludes `@full-stack` tests
- `--ui` - Open Playwright UI for interactive debugging and watch mode
- `--debug` - Run in debug mode with browser developer tools
- `--headed` - Run tests in visible browser (default is headless)

### Test Modes

#### Full-Stack Mode (Default)

**Default behavior** - runs with real backend (DocumentDB + API) and demo
ClickHouse data.

**What it includes:**

- DocumentDB (`HDX_E2E_MONGO_PORT`, 21100 + slot) - authentication, teams,
  users, persistence. The API reaches it over the Mongo wire protocol
- API Server (port 29000) - full backend logic
- App Server (port 28081) - frontend
- **Local Docker ClickHouse** (localhost:8123) - seeded E2E test data (logs/traces/metrics/K8s). Seeded timestamps span a past+future window (~1h past, ~2h future from seed time) so relative ranges like "last 5 minutes" keep finding data. If you run tests more than ~2 hours after the last seed, re-run the global setup (or full test run) to re-seed.

**Benefits:**

- Test authentication flows (login, signup, teams)
- Test persistence (saved searches, dashboards, alerts)
- Test real API endpoints and backend logic
- Consistent with production environment
- All features work (auth, persistence, data querying)

```bash
# Default: full-stack mode
make e2e
./scripts/test-e2e.sh --grep "@kubernetes"   # from repo root, for specific tags
```

#### Local Mode (for testing frontend-only features)

**Frontend + ClickHouse mode** - skips DocumentDB/API, uses local Docker ClickHouse
with seeded test data.

**Use for:**

- Quick frontend iteration during development
- Testing UI components that don't need auth
- Faster test execution when backend features aren't needed
- Consistent test data (same as full-stack mode)

**Limitations:**

- No authentication (no login/signup)
- No persistence (can't save searches/dashboards via API)
- No API calls (queries go directly to local ClickHouse)

**Note:** Uses the same Docker ClickHouse and seeded data as full-stack mode,
ensuring consistency between local and full-stack tests.

```bash
# Opt-in to local mode for speed (from repo root)
./scripts/test-e2e.sh --local
./scripts/test-e2e.sh --local --grep "@search"
```

## Writing Tests

Since full-stack is the default, all tests have access to authentication,
persistence, and real backend features:

```typescript
import { expect, test } from '../../utils/base-test';
import { SearchPage } from '../page-objects/SearchPage';

test.describe('My Feature', { tag: '@full-stack' }, () => {
  test('should allow authenticated user to save search', async ({ page }) => {
    const ts = Date.now();
    const searchPage = new SearchPage(page);

    await searchPage.goto();
    await searchPage.openSaveSearchModal();
    await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
      `My Saved Search ${ts}`,
    );

    await expect(searchPage.alertsButton).toBeVisible();
  });
});
```

**Note:** Tests that need to run in full stack mode should be tagged with
`@full-stack` so that when running with `./scripts/test-e2e.sh --local`, they
are skipped appropriately.

### Page Object Pattern

All UI interactions in spec files must go through page objects (`page-objects/`) and components (`components/`). Never use raw `page.getByTestId()`, `page.locator()`, or `page.getByRole()` directly in spec files. If a needed interaction doesn't exist in a page object, add it there first.

### Data Isolation

Tests run in parallel and share a database. Use `Date.now()` for **every field the API uniqueness-checks** — not just display names:

```typescript
const ts = Date.now();
const name = `E2E Thing ${ts}`;
const url = `https://example.com/thing-${ts}`; // URL fields too, not just name
```

The webhook API enforces uniqueness on `(team, service, url)`. A hardcoded URL will collide between parallel runs or retries and cause the form to stay open (API returns 400).

### Scoped Assertions

Never assert global counts — other tests' data is in the shared DB. Scope assertions to the current test's unique data:

```typescript
// ❌ Brittle — other tests' alerts pollute the count
await expect(alertsPage.getAlertCards()).toHaveCount(1);

// ✅ Scoped to this test's data
await expect(
  alertsPage.pageContainer.getByRole('link').filter({ hasText: name }),
).toBeVisible();
```

### AI-Assisted Test Writing

The project ships with AI tooling for generating, fixing, and planning E2E tests using a live browser via the [Playwright MCP server](https://github.com/microsoft/playwright/tree/main/packages/playwright-mcp).

#### Claude Code

Use the `/playwright <description>` skill. It orchestrates three agents:

- **`playwright-test-generator`** — drives a real browser, executes steps live, writes spec code following HyperDX conventions
- **`playwright-test-healer`** — debugs failing tests interactively using the MCP browser tools
- **`playwright-test-planner`** — explores the UI and produces a structured test plan before writing code

```
/playwright write a test that creates an alert from a saved search
```

The skill automatically runs the test after generation and invokes the healer if it fails. Update `.claude/skills/playwright/SKILL.md` if the output doesn't match project conventions.

#### Cursor

The Playwright MCP server is pre-configured in `.cursor/mcp.json`. Enable it under **Settings → Tools & MCP**.

To write a test, reference the `@playwright` rule in your prompt — it loads all HyperDX conventions automatically:

```
@playwright write a new E2E test at packages/app/tests/e2e/features/search.spec.ts
that verifies a user can save a search and see it in the sidebar
```

To fix a failing test:

```
@playwright this test is failing with [error]. Debug and fix it using the Playwright MCP tools.
```

The `@playwright` rule is a thin wrapper that points to `.claude/skills/playwright/SKILL.md` as the single source of truth for conventions — so both Claude Code and Cursor stay in sync automatically.

## Test Organization

```
tests/e2e/
├── core/                 # Core application functionality
│   └── navigation.spec.ts # Navigation and routing
├── features/             # Feature-specific tests
│   ├── alerts.spec.ts
│   ├── chart-explorer.spec.ts
│   ├── dashboard.spec.ts
│   ├── search/
│   │   ├── search.spec.ts
│   │   ├── search-filters.spec.ts
│   │   └── saved-search.spec.ts
│   ├── sessions.spec.ts
│   └── traces-workflow.spec.ts
└── utils/                # Test utilities and helpers
    └── base-test.ts
```

## Debugging Tests

The `test:e2e` command supports flags for different modes:

### Interactive Mode

Run tests with the Playwright UI for interactive debugging:

```bash
# Full-stack mode (default)
yarn test:e2e --ui

# Local mode (frontend only)
yarn test:e2e --ui --local
```

### Debug Mode

Run tests in debug mode with browser developer tools:

```bash
# Full-stack mode (default)
yarn test:e2e --debug

# Local mode
yarn test:e2e --debug --local
```

### CI Mode

Run tests in ci mode, which runs it in a docker container and environment
similar to how it runs inside of Github Actions

```bash
yarn test:e2e:ci
```

### Single Test Debugging

To debug a specific test file, pass the file path as an argument:

```bash
# Full-stack mode (default)
yarn test:e2e tests/e2e/features/search/search.spec.ts --debug

# Local mode
yarn test:e2e tests/e2e/features/search/search.spec.ts --debug --local
```

### Headed Mode

Run tests in headed mode (visible browser):

```bash
# Full-stack mode (default)
yarn test:e2e --headed

# Local mode
yarn test:e2e --headed --local
```

## Test Output and Reports

### HTML Reports

After test execution, view the detailed HTML report:

```bash
yarn playwright show-report
```

The report includes:

- Test execution timeline
- Screenshots of failures
- Video recordings of failed tests
- Network logs and console output

### Test Results

Test artifacts are stored in:

- `test-results/` - Screenshots, videos, and traces for failed tests
- `playwright-report/` - HTML report files

### Trace Viewer

For detailed debugging of failed tests, use the trace viewer:

```bash
yarn playwright show-trace test-results/[test-name]/trace.zip
```

## Configuration

The test configuration is defined in `playwright.config.ts`:

- **Base URL**: `http://localhost:8080` (configurable via `PLAYWRIGHT_BASE_URL`)
- **Test Timeout**: 60 seconds (increased from default 30s to reduce flaky test
  failures)
- **Retries**: 1 retry locally, 2 on CI
- **Workers**: Undefined (uses Playwright defaults)
- **Screenshots**: Captured on failure only
- **Videos**: Recorded and retained on failure
- **Traces**: Collected on first retry
- **Global Setup**: Ensures server readiness before tests
- **Web Server**: Automatically starts local dev server with local mode enabled

## Test Development

### Writing Tests

Tests use the extended base test from `utils/base-test.ts` which provides:

- Automatic handling of connection/sources
- Tanstack Query devtools management
- Network idle waiting after navigation

### Best Practices

- Use data test IDs for reliable element selection
- Implement proper wait strategies for dynamic content
- Group related assertions in test steps
- Use descriptive test names and organize with appropriate tags
- Clean up test data when necessary

## Configuration Details

### Port Configuration

**Local Environment (make e2e):**

- DocumentDB: `HDX_E2E_MONGO_PORT` (21100 + slot), mapped to the gateway's
  port 10260
- API Server: 29000
- App Server: 28081

**CI Environment (GitHub Actions):**

- DocumentDB: 21100, from the same compose file (`.github/actions/e2e-setup`)
- API Server: 29000
- App Server: 28081

Locally the port is offset by the worktree slot so several worktrees can run
e2e at once; CI runs one stack per runner at slot 0.

### Playwright Configuration

The test setup uses Playwright's `webServer` array feature (v1.32+) to start
multiple servers:

- API server (port 29000) - loads `.env.e2e` configuration
- App server (port 28081) - connects to API

## Troubleshooting

### Common Issues

**Server connection errors:**

- Port 28081 (full-stack) or 8081 (local mode) already in use
- Check development server started successfully
- Verify environment variables in `.env.e2e`

**DocumentDB connection issues (full-stack mode):**

- Check the slot's port is free: `lsof -i :$HDX_E2E_MONGO_PORT`
- View DocumentDB logs (a failed Postgres start prints its log here):
  `docker compose -p e2e-<slot> -f tests/e2e/docker-compose.yml logs db`
- DocumentDB is started by `make e2e`, which waits for its healthcheck

**Sources don't appear in UI:**

- Check API logs for `setupTeamDefaults` errors
- Verify `DEFAULT_SOURCES` in `.env.e2e` points to local Docker ClickHouse (localhost:8123)
- Ensure you registered a new user (DEFAULT_SOURCES only applies to new teams)

**Tests can't find demo data:**

- Verify sources use `default` database with `e2e_` prefixed tables
- Check Network tab - should query `localhost:8123`
- Verify a source is selected in UI dropdown

### Flaky Tests

For intermittent failures:

1. Check the HTML report for timing issues
2. Review network logs for failed requests
3. Consider if individual test steps need longer wait times (global timeout is
   now 60s)
4. Use the trace viewer to analyze test execution

### CI/CD Integration

Tests run in **full-stack mode** on CI (GitHub Actions) with:

- DocumentDB container for authentication and persistence
- Local Docker ClickHouse for telemetry data (same as local mode)
- 60-second test timeout (same as local)
- Multiple retry attempts (2 retries on CI vs 1 locally)
- Artifact collection for failed tests
- GitHub Actions integration for PR comments
- Parallel execution across 4 shards for faster feedback
