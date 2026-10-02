import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { isTestFile } from "./lib/files.mjs";
import { repositoryRoot } from "./lib/process.mjs";

const sourceRoot = path.join(repositoryRoot, "src");
const testsRoot = path.join(repositoryRoot, "tests");
const benchRoot = path.join(repositoryRoot, "bench");
const checkBuilt = process.argv.includes("--built");
const manifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);
const runtimeDependencyNames = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);
const developmentDependencyNames = new Set(
  Object.keys(manifest.devDependencies ?? {}),
);

function walkTypeScriptFiles(absoluteDirectory) {
  if (!existsSync(absoluteDirectory)) {
    return [];
  }
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        return walkTypeScriptFiles(absolutePath);
      }
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
    },
  );
}

function importSpecifiers(contents) {
  const codeLines = contents
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n");
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^import\s+["']([^"']+)["']/gm,
  ];
  return patterns.flatMap((pattern) =>
    [...codeLines.matchAll(pattern)].map((match) => match[1]),
  );
}

function bareSpecifierPackageName(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function pathIsInside(absolutePath, allowedRoot) {
  return (
    absolutePath === allowedRoot ||
    absolutePath.startsWith(`${allowedRoot}${path.sep}`)
  );
}

function validateSpecifier(
  absolutePath,
  specifier,
  allowedDependencies,
  allowedRoots,
) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (specifier.startsWith(".")) {
    const resolvedPath = path.resolve(path.dirname(absolutePath), specifier);
    return allowedRoots.some((root) => pathIsInside(resolvedPath, root))
      ? []
      : [
          `${relativePath}: relative import escapes its project boundary: ${specifier}`,
        ];
  }
  if (specifier.startsWith("node:") && isTestFile(relativePath)) {
    return [];
  }
  return allowedDependencies.has(bareSpecifierPackageName(specifier))
    ? []
    : [`${relativePath}: import is not a declared dependency: ${specifier}`];
}

function validatePackageImports() {
  return [
    ...walkTypeScriptFiles(sourceRoot),
    ...walkTypeScriptFiles(testsRoot),
  ].flatMap((absolutePath) => {
    const relativePath = path.relative(repositoryRoot, absolutePath);
    const allowedDependencies = isTestFile(relativePath)
      ? new Set([...runtimeDependencyNames, ...developmentDependencyNames])
      : runtimeDependencyNames;
    const allowedRoots = isTestFile(relativePath)
      ? [sourceRoot, testsRoot, benchRoot]
      : [sourceRoot];
    return importSpecifiers(readFileSync(absolutePath, "utf8")).flatMap(
      (specifier) =>
        validateSpecifier(
          absolutePath,
          specifier,
          allowedDependencies,
          allowedRoots,
        ),
    );
  });
}

function validateConsumerProject(relativeRoot) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot);
  const projectManifest = JSON.parse(
    readFileSync(path.join(absoluteRoot, "package.template.json"), "utf8"),
  );
  const allowedDependencies = new Set([
    ...Object.keys(projectManifest.dependencies ?? {}),
    ...Object.keys(projectManifest.devDependencies ?? {}),
  ]);
  return walkTypeScriptFiles(path.join(absoluteRoot, "src")).flatMap(
    (absolutePath) =>
      importSpecifiers(readFileSync(absolutePath, "utf8")).flatMap(
        (specifier) =>
          validateSpecifier(absolutePath, specifier, allowedDependencies, [
            absoluteRoot,
          ]),
      ),
  );
}

function validateExports() {
  const rootExport = manifest.exports?.["."];
  return [
    validateRootExport(rootExport),
    validateStylesheetExport(),
    validateFilesAllowlist(),
  ].filter(Boolean);
}

function validateRootExport(rootExport) {
  return rootExport?.types === "./dist/index.d.ts" &&
    rootExport?.import === "./dist/onirigiri.js"
    ? ""
    : "package.json: root export must map to dist/index.d.ts and dist/onirigiri.js";
}

function validateStylesheetExport() {
  return manifest.exports?.["./styles.css"] === "./dist/onirigiri.css"
    ? ""
    : "package.json: stylesheet export must map to ./dist/onirigiri.css";
}

function validateFilesAllowlist() {
  return Array.isArray(manifest.files) && manifest.files.includes("dist")
    ? ""
    : "package.json: files must explicitly include dist";
}

function validateTsconfigAliases() {
  return ["tsconfig.json", "tsconfig.build.json"].flatMap((name) => {
    const compilerOptions = JSON.parse(
      readFileSync(path.join(repositoryRoot, name), "utf8"),
    ).compilerOptions;
    return ["paths", "baseUrl"].flatMap((option) =>
      compilerOptions && option in compilerOptions
        ? [`${name}: ${option} would alias the package dependency graph`]
        : [],
    );
  });
}

function validateBuiltEntry() {
  const entryPath = path.join(repositoryRoot, "dist/onirigiri.js");
  if (!existsSync(entryPath)) {
    return ["dist/onirigiri.js: missing; run the package build first"];
  }
  return importSpecifiers(readFileSync(entryPath, "utf8")).flatMap(
    (specifier) => {
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        return [
          `dist/onirigiri.js: bundled output must not import by path: ${specifier}`,
        ];
      }
      return runtimeDependencyNames.has(bareSpecifierPackageName(specifier))
        ? []
        : [
            `dist/onirigiri.js: import is not a declared runtime dependency or peer: ${specifier}`,
          ];
    },
  );
}

function validateBuiltStylesheet() {
  const stylesheetPath = path.join(repositoryRoot, "dist/onirigiri.css");
  if (!existsSync(stylesheetPath)) {
    return [];
  }
  const contents = readFileSync(stylesheetPath, "utf8");
  return [
    ...(/^(?:\*|html\b|body\b|:root\b)/gmu.test(contents)
      ? [
          "dist/onirigiri.css: contains a host-wide selector; styles must stay scoped to Onirigiri",
        ]
      : []),
    ...(contents.includes(".onirigiri-workspace")
      ? []
      : ["dist/onirigiri.css: missing the .onirigiri-workspace scope"]),
  ];
}

function validateBuiltArtifacts() {
  const requiredArtifacts = [
    "dist/index.d.ts",
    "dist/onirigiri.css",
    "dist/onirigiri.js",
    "dist/onirigiri.js.map",
  ];
  const missing = requiredArtifacts.flatMap((relativePath) =>
    existsSync(path.join(repositoryRoot, relativePath))
      ? []
      : [`${relativePath}: missing build artifact`],
  );
  return [...missing, ...validateBuiltEntry(), ...validateBuiltStylesheet()];
}

const failures = [
  ...validateExports(),
  ...validatePackageImports(),
  ...validateConsumerProject("fixtures/packed-consumer"),
  ...validateTsconfigAliases(),
  ...(checkBuilt ? validateBuiltArtifacts() : []),
];

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Package boundary passed (${checkBuilt ? "source and built" : "source"} artifacts).`,
);
