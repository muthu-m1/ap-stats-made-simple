// Bundles the official Anthropic SDK into one browser file, so the site loads nothing from a CDN: npm run sdk
import { build } from "esbuild";

await build({
  stdin: { contents: 'export { default } from "@anthropic-ai/sdk";', resolveDir: process.cwd() },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  outfile: "assets/vendor/anthropic.js",
});
console.log("Wrote assets/vendor/anthropic.js");
