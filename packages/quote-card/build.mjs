import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const here = (p) => new URL(p, import.meta.url);

// zod re-exports every locale as a namespace, and the MCP Apps SDK imports
// zod's `z` namespace object, so the bundler keeps all ~40 locales (250 KiB).
// The card only ever needs English messages.
const englishOnlyZodLocales = {
  name: "english-only-zod-locales",
  setup(b) {
    b.onResolve({ filter: /^\.\.\/locales\/index\.js$/ }, (args) =>
      /[\\/]zod[\\/]v4[\\/]/.test(args.importer)
        ? { path: new URL("../locales/en.js", `file://${args.importer}`).pathname, namespace: "zod-en" }
        : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "zod-en" }, (args) => ({
      contents: `export { default as en } from ${JSON.stringify(args.path)};`,
      resolveDir: "/",
    }));
  },
};

const result = await build({
  entryPoints: [here("src/main.tsx").pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  write: false,
  outdir: here("dist/bundle").pathname,
  legalComments: "none",
  plugins: [englishOnlyZodLocales],
});

const output = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? "";
const js = output(".js").replaceAll("</script", "<\\/script");
// Tailwind first: it declares the cascade layer order that the kit's CSS modules (in esbuild's output) slot into.
const tailwind = execFileSync(here("node_modules/.bin/tailwindcss").pathname, ["-i", here("src/main.css").pathname, "--minify"], {
  cwd: here(".").pathname,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const css = (tailwind + output(".css")).replaceAll("</style", "<\\/style");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quote</title>
<style>${css}</style>
</head>
<body>
<main id="root"></main>
<script>${js}</script>
</body>
</html>
`;

await mkdir(here("dist"), { recursive: true });
await writeFile(here("dist/quote-card.html"), html);
await writeFile(here("dist/index.js"), `export const QUOTE_CARD_HTML = ${JSON.stringify(html)};\n`);
await writeFile(here("dist/index.d.ts"), "export declare const QUOTE_CARD_HTML: string;\n");
console.log(`quote-card.html ${(html.length / 1024).toFixed(1)} KiB`);
