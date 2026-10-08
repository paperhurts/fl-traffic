import { defineConfig } from "vitest/config";

// `base: "./"` keeps every URL relative, so the same build works at
// paperhurts.github.io/fl-traffic/, at a custom domain, or under `vite preview`.
export default defineConfig({
  base: "./",
  // Other local projects use 5173/4173, 5180, and 5190/4190 (waterways); stay off them.
  server: { port: 5191, strictPort: true },
  preview: { port: 4191, strictPort: true },
  // MapLibre is most of the bundle (about 300 kB gzipped) and can't be split usefully.
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  // MapLibre starts its worker as a module worker.
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
