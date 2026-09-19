// Builds dist/ with the TypeScript compiler only (no native binaries):
//   dist/esm/index.js     ES module  (import)
//   dist/cjs/index.cjs    CommonJS   (require)
//   dist/types/index.d.ts types
//   dist/creptapay.js     <script> build, exposes window.CreptaPay
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScript() {
    const candidates = [root, join(root, "../.."), join(root, "../../apps/checkout")];
    for (const base of candidates) {
        try {
            const ts = require(require.resolve("typescript", { paths: [base] }));
            if (ts && ts.ModuleKind && ts.createProgram) return ts;
        } catch {}
    }
    throw new Error("typescript not found. Run `npm install` first.");
}
const ts = loadTypeScript();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entry = join(root, "src/index.ts");

function compile(outDir, options) {
    const program = ts.createProgram([entry], {
        target: ts.ScriptTarget.ES2018,
        lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        outDir,
        ...options,
    });
    const result = program.emit();
    const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
    if (diagnostics.length) {
        const host = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" };
        console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
        process.exit(1);
    }
}

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

compile(join(dist, "esm"), { module: ts.ModuleKind.ES2020 });
compile(join(dist, "cjs"), { module: ts.ModuleKind.CommonJS });
renameSync(join(dist, "cjs/index.js"), join(dist, "cjs/index.cjs"));
compile(join(dist, "types"), { declaration: true, emitDeclarationOnly: true });

// Browser <script> build: wrap the CommonJS output in an IIFE.
const cjs = readFileSync(join(dist, "cjs/index.cjs"), "utf8");
const banner = `/*! @creptapay/checkout v${pkg.version} | ${pkg.license} */`;
const iife = `${banner}
(function (global) {
  var api = (function () {
    var module = { exports: {} }, exports = module.exports;
${cjs.replace(/^/gm, "    ")}
    return module.exports;
  })();
  var Client = api.CreptaPay;
  Client.CreptaPay = api.CreptaPay;
  Client.CreptaPayError = api.CreptaPayError;
  Client.version = ${JSON.stringify(pkg.version)};
  global.CreptaPay = Client;
  if (typeof global.dispatchEvent === "function" && typeof Event === "function") {
    global.dispatchEvent(new Event("creptapay:ready"));
  }
})(typeof window !== "undefined" ? window : this);
`;
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "creptapay.js"), iife);

// package.json "type": "module" makes .js ESM; mark the cjs folder explicitly.
writeFileSync(join(dist, "cjs/package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

console.log(`Built @creptapay/checkout v${pkg.version} -> dist/`);
