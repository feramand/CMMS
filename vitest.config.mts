import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // Las pruebas de integración comparten una base de datos: se ejecutan en serie.
    fileParallelism: false,
  },
});
