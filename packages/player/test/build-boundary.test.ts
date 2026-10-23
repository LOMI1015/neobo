// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, normalizePath, type Plugin } from 'vite';
import { expect, it, vi } from 'vitest';

interface BuiltChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly moduleIds: readonly string[];
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
}

const playerRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/consumer/', import.meta.url));
const playerEntry = normalizePath(fileURLToPath(new URL('../dist/index.js', import.meta.url)));
const sceneRoot = normalizePath(fileURLToPath(new URL('../../scene/', import.meta.url)));
const webRoot = normalizePath(fileURLToPath(new URL('../../../apps/web/', import.meta.url)));
const runtimeExports = [
  'ScenePlayer',
  'SceneView',
  'createSceneComponentRegistry',
  'sceneComponents',
];

it('已构建公共出口可独立消费，生产模块图与懒加载产物不携带编辑链', async () => {
  // 原生 Node 解析 dist 的 ESM 导入，避免源码别名掩盖缺失扩展名或公开出口。
  const nativeExports: unknown = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'const player = await import("@neobo/player"); process.stdout.write(JSON.stringify(Object.keys(player).sort()));',
      ],
      { cwd: playerRoot, encoding: 'utf8', timeout: 5_000 },
    ),
  );
  expect(nativeExports).toEqual(runtimeExports.toSorted());

  const moduleIds: string[] = [];
  const publicExports: string[] = [];
  const chunks: BuiltChunk[] = [];
  const outputFiles = new Set<string>();
  const probe: Plugin = {
    name: 'player-consumer-boundary',
    generateBundle(_, bundle) {
      moduleIds.push(...Array.from(this.getModuleIds(), normalizePath));
      publicExports.push(...(this.getModuleInfo(playerEntry)?.exports ?? []));
      for (const output of Object.values(bundle)) {
        outputFiles.add(output.fileName);
        if (output.type === 'chunk') {
          chunks.push({
            fileName: output.fileName,
            isEntry: output.isEntry,
            isDynamicEntry: output.isDynamicEntry,
            moduleIds: output.moduleIds.map(normalizePath),
            imports: [...output.imports],
            dynamicImports: [...output.dynamicImports],
          });
        }
      }
    },
  };

  vi.stubEnv('NODE_ENV', 'production');
  try {
    // 使用独立入口和默认生产分包，仅在内存生成，不读取 Web 配置或落盘产物。
    await build({
      root: fixtureRoot,
      configFile: false,
      envFile: false,
      publicDir: false,
      plugins: [react(), probe],
      logLevel: 'warn',
      build: { write: false, reportCompressedSize: false },
    });
  } finally {
    vi.unstubAllEnvs();
  }

  expect(publicExports.toSorted()).toEqual(runtimeExports.toSorted());
  expect(moduleIds).toContain(playerEntry);
  expect(moduleIds).toContain(`${sceneRoot}dist/document.js`);
  expect(moduleIds.some((id) => id.includes('/packages/player/dist/SceneView.js'))).toBe(true);
  expect(moduleIds.some((id) => id.includes('/node_modules/echarts/lib/chart/bar/'))).toBe(true);
  expect(moduleIds.some((id) => id.includes('/node_modules/zrender/lib/svg/'))).toBe(true);
  expect(
    moduleIds.filter(
      (id) =>
        id.startsWith(webRoot) ||
        id.includes('/packages/player/src/') ||
        /\/node_modules\/(?:@radix-ui\/|radix-ui\/|shadcn\/)/u.test(id) ||
        ['index', 'commands', 'history', 'geometry'].some(
          (name) => id === `${sceneRoot}dist/${name}.js`,
        ),
    ),
  ).toEqual([]);

  const chartChunks = chunks.filter((chunk) =>
    chunk.moduleIds.some((id) => id.endsWith('/packages/player/dist/BarChartSurface.js')),
  );
  expect(chartChunks).toHaveLength(1);
  expect(chartChunks[0]?.isDynamicEntry).toBe(true);
  expect(chunks.some((chunk) => chunk.isEntry)).toBe(true);

  // 逐条核对打包器产物引用，外置或丢失依赖不能靠构建字符串检查蒙混通过。
  for (const chunk of chunks) {
    for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
      expect(outputFiles.has(imported), `${chunk.fileName} 缺少产物 ${imported}`).toBe(true);
    }
  }
  expect(
    chunks.some((chunk) =>
      chartChunks.some((chart) => chunk.dynamicImports.includes(chart.fileName)),
    ),
  ).toBe(true);

  const eagerFiles = new Set(
    chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
  );
  const pending = [...eagerFiles];
  while (pending.length > 0) {
    const filename = pending.pop();
    const chunk = chunks.find((entry) => entry.fileName === filename);
    for (const imported of chunk?.imports ?? []) {
      if (!eagerFiles.has(imported)) {
        eagerFiles.add(imported);
        pending.push(imported);
      }
    }
  }
  expect(
    chunks
      .filter((chunk) => eagerFiles.has(chunk.fileName))
      .flatMap((chunk) => chunk.moduleIds)
      .filter((id) => /\/node_modules\/(?:echarts|zrender)\//u.test(id)),
  ).toEqual([]);
}, 20_000);
