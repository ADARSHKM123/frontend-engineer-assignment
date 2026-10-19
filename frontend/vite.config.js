import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app runs on :5173, so the pages on :4001 are always a different origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
