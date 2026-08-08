import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const msgpackSource = resolve(root, "node_modules", "msgpack-lite", "dist", "msgpack.min.js");
const files = [
  ["manifest.json", "manifest.json"],
  ["popup.html", "popup.html"],
  ["manage.html", "manage.html"],
  ["assets/logo.svg", "assets/logo.svg"],
  ["assets/vendor/fontawesome/all.min.css", "assets/vendor/fontawesome/all.min.css"],
  ["assets/vendor/fontawesome/webfonts/fa-solid-900.woff2", "assets/vendor/fontawesome/webfonts/fa-solid-900.woff2"],
  ["assets/vendor/fontawesome/webfonts/fa-regular-400.woff2", "assets/vendor/fontawesome/webfonts/fa-regular-400.woff2"],
  ["assets/vendor/fontawesome/webfonts/fa-brands-400.woff2", "assets/vendor/fontawesome/webfonts/fa-brands-400.woff2"],
  ["assets/vendor/fontawesome/webfonts/fa-solid-900.ttf", "assets/vendor/fontawesome/webfonts/fa-solid-900.ttf"],
  ["assets/vendor/fontawesome/webfonts/fa-regular-400.ttf", "assets/vendor/fontawesome/webfonts/fa-regular-400.ttf"],
  ["assets/vendor/fontawesome/webfonts/fa-brands-400.ttf", "assets/vendor/fontawesome/webfonts/fa-brands-400.ttf"],
  ["assets/icon-16.png", "assets/icon-16.png"],
  ["assets/icon-32.png", "assets/icon-32.png"],
  ["assets/icon-48.png", "assets/icon-48.png"],
  ["assets/icon-128.png", "assets/icon-128.png"],
  ["rules/block-mmstat.json", "rules/block-mmstat.json"],
  [msgpackSource, "libs/msgpack.min.js"]
];

for (const [source, target] of files) {
  const from = resolve(source) === source ? source : resolve(root, source);
  const to = resolve(root, "dist", target);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
