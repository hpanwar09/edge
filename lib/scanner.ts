import { dirname, join, normalize, relative, resolve } from "jsr:@std/path";

export interface ScannerOptions {
  extensions?: string[];
  concurrency?: number;
}

export interface ScannerResult {
  graph: { [path: string]: string[] };
  fileTypes: { [extension: string]: number };
}

interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  fileType: SupportedExtension;
}

type SupportedExtension = ".rb" | ".slim" | ".js" | ".jsx" | ".ts" | ".tsx";

const DEFAULT_CONCURRENCY = 64;
const ROOT_VIEW_PATH = "app/views";
const SCRIPT_EXTENSIONS: SupportedExtension[] = [".js", ".jsx", ".ts", ".tsx"];
const DEFAULT_EXTENSIONS: SupportedExtension[] = [
  ".rb",
  ".slim",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
];
const DIRECTORIES_TO_SKIP = new Set(["node_modules", ".git", "tmp", "log"]);

const RUBY_REQUIRE_REGEX =
  /^\s*(require|require_relative|load|require_all)\s+['"]([^'"]+)['"]/gm;
const RUBY_AUTOLOAD_REGEX = /^\s*autoload\s+:(\w+)\s*,\s*['"]([^'"]+)['"]/gm;
const SLIM_PARTIAL_RENDER_REGEX =
  /^\s*==?\s+render\s+(?:partial:\s*)?['"]([^'"]+)['"]/gm;
const SLIM_COMPONENT_RENDER_REGEX =
  /^\s*==?\s+render\s+([A-Z]\w+(?:::\w+)*)(?:\.new)?/gm;
const JAVASCRIPT_IMPORT_REGEX = /^\s*import\s+.*from\s+['"]([^'"]+)['"]/gm;
const JAVASCRIPT_SIDE_EFFECT_IMPORT_REGEX = /^\s*import\s+['"]([^'"]+)['"]/gm;
const JAVASCRIPT_REQUIRE_REGEX =
  /(?:require|require\.resolve)\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

export class MultiLanguageScanner {
  private readonly rootPath: string;
  private readonly extensions: Set<SupportedExtension>;
  private readonly concurrency: number;

  constructor(rootPath: string, options: ScannerOptions = {}) {
    this.rootPath = resolve(rootPath);
    this.extensions = new Set(normalizeExtensions(options.extensions));
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  async scan(): Promise<ScannerResult> {
    const files = await this.walkDirectory();
    const resolver = new DependencyResolver(files);

    const fileTypes = files.reduce<{ [extension: string]: number }>(
      (counts, file) => {
        counts[file.fileType] = (counts[file.fileType] ?? 0) + 1;
        return counts;
      },
      {}
    );

    const graphEntries = await mapWithConcurrency(
      files,
      this.concurrency,
      async (file) => {
        const dependencies = await this.scanFile(file, resolver);
        return [file.relativePath, dependencies] as const;
      }
    );

    const graph = Object.fromEntries(graphEntries);

    return { graph, fileTypes };
  }

  private async walkDirectory(): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    const queue: string[] = [this.rootPath];

    while (queue.length > 0) {
      const currentDirectory = queue.shift()!;

      for await (const entry of Deno.readDir(currentDirectory)) {
        const absolutePath = join(currentDirectory, entry.name);
        const relativePath = toPortablePath(
          relative(this.rootPath, absolutePath)
        );

        if (entry.isDirectory) {
          if (shouldSkipDirectory(relativePath)) {
            continue;
          }

          queue.push(absolutePath);
          continue;
        }

        if (!entry.isFile) {
          continue;
        }

        const fileType = detectSupportedExtension(relativePath);
        if (!fileType || !this.extensions.has(fileType)) {
          continue;
        }

        files.push({ absolutePath, relativePath, fileType });
      }
    }

    files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    );

    return files;
  }

  private async scanFile(
    file: ScannedFile,
    resolver: DependencyResolver
  ): Promise<string[]> {
    const contents = await Deno.readTextFile(file.absolutePath);
    const dependencies = new Set<string>();

    if (file.fileType === ".rb") {
      this.collectRubyDependencies(file, contents, resolver, dependencies);
    }

    if (file.fileType === ".slim") {
      this.collectSlimDependencies(file, contents, resolver, dependencies);
    }

    if (SCRIPT_EXTENSIONS.includes(file.fileType)) {
      this.collectScriptDependencies(file, contents, resolver, dependencies);
    }

    return [...dependencies].sort((left, right) => left.localeCompare(right));
  }

  private collectRubyDependencies(
    file: ScannedFile,
    contents: string,
    resolver: DependencyResolver,
    dependencies: Set<string>
  ) {
    for (const match of contents.matchAll(RUBY_REQUIRE_REGEX)) {
      const keyword = match[1];
      const target = match[2];

      const resolvedDependency =
        keyword === "require_relative"
          ? resolver.resolveRelativeRuby(file.relativePath, target)
          : resolver.resolveRubyLoadPath(target);

      if (resolvedDependency && resolvedDependency !== file.relativePath) {
        dependencies.add(resolvedDependency);
      }
    }

    for (const match of contents.matchAll(RUBY_AUTOLOAD_REGEX)) {
      const target = match[2];
      const resolvedDependency = resolver.resolveRubyLoadPath(target);

      if (resolvedDependency && resolvedDependency !== file.relativePath) {
        dependencies.add(resolvedDependency);
      }
    }
  }

  private collectSlimDependencies(
    file: ScannedFile,
    contents: string,
    resolver: DependencyResolver,
    dependencies: Set<string>
  ) {
    for (const match of contents.matchAll(SLIM_PARTIAL_RENDER_REGEX)) {
      const resolvedDependency = resolver.resolveSlimPartial(
        file.relativePath,
        match[1]
      );

      if (resolvedDependency && resolvedDependency !== file.relativePath) {
        dependencies.add(resolvedDependency);
      }
    }

    for (const match of contents.matchAll(SLIM_COMPONENT_RENDER_REGEX)) {
      const resolvedDependency = resolver.resolveSlimComponent(match[1]);

      if (resolvedDependency && resolvedDependency !== file.relativePath) {
        dependencies.add(resolvedDependency);
      }
    }
  }

  private collectScriptDependencies(
    file: ScannedFile,
    contents: string,
    resolver: DependencyResolver,
    dependencies: Set<string>
  ) {
    for (const regex of [
      JAVASCRIPT_IMPORT_REGEX,
      JAVASCRIPT_SIDE_EFFECT_IMPORT_REGEX,
      JAVASCRIPT_REQUIRE_REGEX,
    ]) {
      for (const match of contents.matchAll(regex)) {
        const resolvedDependency = resolver.resolveScriptImport(
          file.relativePath,
          match[1]
        );

        if (resolvedDependency && resolvedDependency !== file.relativePath) {
          dependencies.add(resolvedDependency);
        }
      }
    }
  }
}

class DependencyResolver {
  private readonly filesByRelativePath = new Map<string, ScannedFile>();
  private readonly rubySuffixIndex = new Map<string, string[]>();

  constructor(files: ScannedFile[]) {
    for (const file of files) {
      this.filesByRelativePath.set(file.relativePath, file);

      if (file.fileType === ".rb") {
        const relativeWithoutExtension = file.relativePath.replace(/\.rb$/, "");
        this.indexRubySuffixes(relativeWithoutExtension, file.relativePath);
        this.indexRubySuffixes(file.relativePath, file.relativePath);
      }
    }

    for (const [key, values] of this.rubySuffixIndex.entries()) {
      values.sort(compareBySpecificity);
      this.rubySuffixIndex.set(key, deduplicate(values));
    }
  }

  resolveRelativeRuby(
    currentFilePath: string,
    target: string
  ): string | undefined {
    const currentDirectory = dirname(currentFilePath);
    return this.resolvePathFromDirectory(currentDirectory, target, [".rb"]);
  }

  resolveRubyLoadPath(target: string): string | undefined {
    const normalizedTarget = normalizeLookupPath(target);
    if (!normalizedTarget) {
      return undefined;
    }

    const candidateWithExtension = normalizedTarget.endsWith(".rb")
      ? normalizedTarget
      : `${normalizedTarget}.rb`;

    return (
      this.pickRubyCandidate(candidateWithExtension) ??
      this.pickRubyCandidate(normalizedTarget)
    );
  }

  resolveSlimPartial(
    currentFilePath: string,
    partialPath: string
  ): string | undefined {
    const normalizedPartial = normalizeLookupPath(partialPath);
    if (!normalizedPartial) {
      return undefined;
    }

    const partialCandidates: string[] = [];
    const viewSubpath = buildSlimPartialSubpath(normalizedPartial);

    if (!viewSubpath) {
      return undefined;
    }

    if (
      !normalizedPartial.includes("/") &&
      currentFilePath.startsWith(`${ROOT_VIEW_PATH}/`)
    ) {
      const currentViewDirectory = dirname(currentFilePath).replace(
        `${ROOT_VIEW_PATH}/`,
        ""
      );
      partialCandidates.push(
        join(ROOT_VIEW_PATH, currentViewDirectory, viewSubpath)
      );
    }

    partialCandidates.push(join(ROOT_VIEW_PATH, viewSubpath));

    for (const candidate of partialCandidates) {
      const normalizedCandidate = normalizeRelativeCandidate(candidate);
      if (!normalizedCandidate) {
        continue;
      }

      if (this.filesByRelativePath.has(`${normalizedCandidate}.html.slim`)) {
        return `${normalizedCandidate}.html.slim`;
      }

      if (this.filesByRelativePath.has(`${normalizedCandidate}.slim`)) {
        return `${normalizedCandidate}.slim`;
      }
    }

    return undefined;
  }

  resolveSlimComponent(componentName: string): string | undefined {
    const rubyLikePath = underscoreConstantPath(componentName);
    return this.resolveRubyLoadPath(rubyLikePath);
  }

  resolveScriptImport(
    currentFilePath: string,
    target: string
  ): string | undefined {
    if (!isProjectRelativeImport(target)) {
      return undefined;
    }

    const currentDirectory = dirname(currentFilePath);
    const importBase = target.startsWith("/")
      ? target.slice(1)
      : join(currentDirectory, target);

    return this.resolvePathCandidates(importBase, SCRIPT_EXTENSIONS);
  }

  private resolvePathFromDirectory(
    directoryPath: string,
    target: string,
    extensions: SupportedExtension[]
  ): string | undefined {
    return this.resolvePathCandidates(join(directoryPath, target), extensions);
  }

  private resolvePathCandidates(
    basePath: string,
    extensions: SupportedExtension[]
  ): string | undefined {
    const normalizedBasePath = normalizeRelativeCandidate(basePath);
    if (!normalizedBasePath) {
      return undefined;
    }

    if (this.filesByRelativePath.has(normalizedBasePath)) {
      return normalizedBasePath;
    }

    const hasRecognizedExtension = extensions.some((extension) =>
      normalizedBasePath.endsWith(extension)
    );
    if (!hasRecognizedExtension) {
      for (const extension of extensions) {
        const fileCandidate = `${normalizedBasePath}${extension}`;
        if (this.filesByRelativePath.has(fileCandidate)) {
          return fileCandidate;
        }
      }
    }

    for (const extension of extensions) {
      const indexCandidate = `${normalizedBasePath}/index${extension}`;
      if (this.filesByRelativePath.has(indexCandidate)) {
        return indexCandidate;
      }
    }

    return undefined;
  }

  private indexRubySuffixes(relativePath: string, resolvedPath: string) {
    const segments = relativePath.split("/").filter(Boolean);

    for (let index = 0; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join("/");
      const existing = this.rubySuffixIndex.get(suffix) ?? [];
      existing.push(resolvedPath);
      this.rubySuffixIndex.set(suffix, existing);
    }
  }

  private pickRubyCandidate(target: string): string | undefined {
    return this.rubySuffixIndex.get(target)?.[0];
  }
}

function normalizeExtensions(extensions?: string[]): SupportedExtension[] {
  if (!extensions || extensions.length === 0) {
    return [...DEFAULT_EXTENSIONS];
  }

  const normalizedExtensions = extensions
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) =>
      extension.startsWith(".") ? extension : `.${extension}`
    )
    .filter((extension): extension is SupportedExtension =>
      DEFAULT_EXTENSIONS.includes(extension as SupportedExtension)
    );

  return normalizedExtensions.length > 0
    ? deduplicate(normalizedExtensions)
    : [...DEFAULT_EXTENSIONS];
}

function detectSupportedExtension(filePath: string): SupportedExtension | null {
  const lowerCasePath = filePath.toLowerCase();

  if (lowerCasePath.endsWith(".html.slim") || lowerCasePath.endsWith(".slim")) {
    return ".slim";
  }

  if (lowerCasePath.endsWith(".tsx")) {
    return ".tsx";
  }

  if (lowerCasePath.endsWith(".jsx")) {
    return ".jsx";
  }

  if (lowerCasePath.endsWith(".ts")) {
    return ".ts";
  }

  if (lowerCasePath.endsWith(".js")) {
    return ".js";
  }

  if (lowerCasePath.endsWith(".rb")) {
    return ".rb";
  }

  return null;
}

function shouldSkipDirectory(relativePath: string): boolean {
  if (!relativePath) {
    return false;
  }

  const normalizedPath = toPortablePath(relativePath);

  if (
    normalizedPath === "vendor/bundle" ||
    normalizedPath.startsWith("vendor/bundle/")
  ) {
    return true;
  }

  const segments = normalizedPath.split("/");
  return segments.some((segment) => DIRECTORIES_TO_SKIP.has(segment));
}

function normalizeLookupPath(filePath: string): string | null {
  const trimmedPath = filePath.trim().replace(/^\/+/, "");

  return normalizeRelativeCandidate(trimmedPath);
}

function normalizeRelativeCandidate(filePath: string): string | null {
  const normalizedPath = toPortablePath(normalize(filePath));

  if (!normalizedPath || normalizedPath === ".") {
    return null;
  }

  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.startsWith("/")
  ) {
    return null;
  }

  return normalizedPath.replace(/^\.\//, "");
}

function buildSlimPartialSubpath(partialPath: string): string | null {
  const segments = partialPath.split("/").filter(Boolean);
  const lastSegment = segments.pop();

  if (!lastSegment) {
    return null;
  }

  segments.push(lastSegment.startsWith("_") ? lastSegment : `_${lastSegment}`);

  return segments.join("/");
}

function underscoreConstantPath(value: string): string {
  return value
    .split("::")
    .map((segment) =>
      segment
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .replace(/([a-z\d])([A-Z])/g, "$1_$2")
        .toLowerCase()
    )
    .join("/");
}

function isProjectRelativeImport(target: string): boolean {
  return (
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("/")
  );
}

function compareBySpecificity(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }

  return left.localeCompare(right);
}

function deduplicate<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toPortablePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<TResult>(values.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= values.length) {
          return;
        }

        results[currentIndex] = await mapper(
          values[currentIndex],
          currentIndex
        );
      }
    }
  );

  await Promise.all(workers);

  return results;
}
