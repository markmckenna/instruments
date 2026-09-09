// See tests/README.md for what these tests cover and why Playwright.
import { defineConfig } from '@playwright/test';

// Deliberately not 4173 (the `make run` dev port, see ../PROCESS.md) so a
// developer running the app and the test suite at the same time never
// collide on the same port.
const PORT = 4174;

export default defineConfig({
  testDir: './tests',
  // Alongside check.sh's own build/check.log, so every generated artifact
  // lives under build/ instead of a separate top-level test-results/.
  outputDir: 'build/test-results',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    cwd: import.meta.dirname,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
