import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Compiler, Module } from 'webpack';
import { buildWorkflowEntryModuleFromRegistry } from './transforms/workflows';

function getModuleSource(
  module: Module & {
    originalSource?: () => { source(): string | Buffer } | null;
    _source?: { source(): string | Buffer } | null;
  },
): string | null {
  const source = module.originalSource?.() ?? module._source;
  if (!source) {
    return null;
  }

  return source.source().toString();
}

async function writeDebugEntryModule(
  entryFile: string,
  code: string,
  debugOutputDir: string | null | undefined,
): Promise<void> {
  if (!debugOutputDir) {
    return;
  }

  const baseDir = path.dirname(entryFile);
  const relativePath = path.relative(baseDir, entryFile);
  const safeRelativePath = relativePath.startsWith('..') ? path.basename(entryFile) : relativePath;
  const outputPath = path.join(debugOutputDir, 'modules', safeRelativePath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, code, 'utf-8');
}

export class WorkflowExportRegistry {
  private readonly exportsByFile = new Map<string, string[]>();

  register(filePath: string, exportNames: string[]): void {
    if (exportNames.length === 0) {
      return;
    }

    this.exportsByFile.set(filePath, [...new Set(exportNames)]);
  }

  get(filePath: string): string[] | undefined {
    return this.exportsByFile.get(filePath);
  }

  asMap(): Map<string, string[]> {
    return this.exportsByFile;
  }
}

export interface MastraWorkflowEntryPluginOptions {
  entryFile: string;
  registry: WorkflowExportRegistry;
  debugOutputDir?: string | null;
}

export class MastraWorkflowEntryPlugin {
  constructor(private readonly options: MastraWorkflowEntryPluginOptions) {}

  apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap('MastraWorkflowEntryPlugin', compilation => {
      compilation.hooks.finishModules.tapPromise('MastraWorkflowEntryPlugin', async modules => {
        const entryModule = [...modules].find(
          (
            module,
          ): module is Module & {
            resource: string;
            originalSource?: () => { source(): string | Buffer } | null;
            _source?: { source(): string | Buffer } | null;
            _ast?: unknown;
            _sourceSizes?: Map<unknown, unknown>;
          } => 'resource' in module && module.resource === this.options.entryFile,
        );

        if (!entryModule) {
          return;
        }

        const source = getModuleSource(entryModule);
        if (!source) {
          return;
        }

        const code = await buildWorkflowEntryModuleFromRegistry(
          source,
          this.options.entryFile,
          this.options.registry.asMap(),
        );

        entryModule._source = new compiler.webpack.sources.RawSource(code);
        entryModule._ast = null;
        entryModule._sourceSizes?.clear?.();

        await writeDebugEntryModule(this.options.entryFile, code, this.options.debugOutputDir);
      });
    });
  }
}
