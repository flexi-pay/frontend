import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";
import { cpSync } from "node:fs";

// Builds the wallet as a Chrome MV3 extension into dist-extension/.
export default mergeConfig(base, defineConfig({
  base: "./",
  build: { outDir: "dist-extension", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  define: { "import.meta.env.VITE_TARGET": JSON.stringify("extension") },
  plugins: [{
    name: "copy-extension-files",
    closeBundle() {
      cpSync("extension", "dist-extension", { recursive: true });
    },
  }],
}));
