import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

const background = "#0b0b0c";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background, fit: "contain" } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background, fit: "contain" } },
  },
  images: ["public/logo.svg"],
});
