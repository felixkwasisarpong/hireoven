import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    globals: false,
    // Autofill exercises real multi-second waits (option polling, parser waits),
    // so the 5s default is too tight for the combobox/typeahead tests.
    testTimeout: 15000,
  },
})
