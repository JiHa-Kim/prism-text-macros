import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const cwd = process.cwd();
const src = join(cwd, "node_modules", "mathjax", "es5");
const dest = join(cwd, "public", "libs", "mathjax");

try {
  await mkdir(dest, { recursive: true });
  
  // Copy main file
  await cp(join(src, "tex-chtml.js"), join(dest, "tex-chtml.js"));
  
  // Copy output directory (fonts etc)
  await cp(join(src, "output"), join(dest, "output"), { recursive: true });

  // Copy input directory (extensions etc)
  await cp(join(src, "input"), join(dest, "input"), { recursive: true });
  
  console.log("MathJax assets copied successfully.");
} catch (error) {
  console.error("Error copying MathJax assets:", error);
  process.exit(1);
}
