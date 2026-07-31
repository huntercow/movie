import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const msgpackSource = resolve(root, "node_modules", "msgpack-lite", "dist", "msgpack.min.js");
const files = [
  ["manifest.json", "manifest.json"],
  ["popup.html", "popup.html"],
  ["闲鱼业务话术_2026-03-16.json", "config/xianyu-reply-templates.json"],
  ["闲鱼关键词回复规则_2026-03-16.json", "config/xianyu-keyword-rules.json"],
  [msgpackSource, "libs/msgpack.min.js"]
];

for (const [source, target] of files) {
  const from = resolve(source) === source ? source : resolve(root, source);
  const to = resolve(root, "dist", target);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
