// tsc, eslint и jest параллельно: подряд они идут ~50 с, вместе — по самому долгому (~20 с).
// Печатает только итог и вывод упавших проверок.
//
//   npm run check
import { spawn } from "node:child_process";

const CHECKS = [
  { name: "tsc", args: ["tsc", "--noEmit"] },
  // Предупреждения не валят проверку, а в выводе только шумят.
  { name: "eslint", args: ["eslint", ".", "--quiet"] },
  { name: "jest", args: ["jest", "--silent"] },
];

function run({ name, args }) {
  const started = Date.now();

  return new Promise((resolve) => {
    // shell: на Windows npx — это npx.cmd.
    const child = spawn(`npx ${args.join(" ")}`, { shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ name, code, output, seconds: (Date.now() - started) / 1000 }));
  });
}

const results = await Promise.all(CHECKS.map(run));
const failed = results.filter((r) => r.code !== 0);

for (const r of failed) {
  console.log(`\n===== ${r.name}: упало =====`);
  console.log(r.output.trim().split(/\r?\n/).slice(-80).join("\n"));
}

const jestSummary = results
  .find((r) => r.name === "jest")
  ?.output.split(/\r?\n/)
  .find((line) => line.startsWith("Tests:"));

console.log(
  "\n" +
    results.map((r) => `${r.name} ${r.code === 0 ? "ok" : "УПАЛО"} (${r.seconds.toFixed(0)} с)`).join(" · ") +
    (jestSummary ? ` · ${jestSummary.trim()}` : ""),
);

process.exit(failed.length > 0 ? 1 : 0);
