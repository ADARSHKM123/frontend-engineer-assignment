import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app runs on :5173. The API is on :4000 and the preview pages on :4001,
// so the previews are always a different origin from the app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
