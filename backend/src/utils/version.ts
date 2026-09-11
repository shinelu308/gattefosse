/**
 * 系统版本自动管理（2026-09-11）
 * 版本存 settings 表（key=system_version，形如 v2.0.0）。
 * 启动时对比「构建标识」（dist/index.js 的 mtime）：标识变化 = 新构建部署 → patch 位自动 +1；
 * 手动重启（dist 未变）不递增。本地与线上库各自独立累计。
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const VERSION_KEY = 'system_version';
const BUILD_KEY = 'system_build_id';
const DEFAULT_VERSION = 'v2.0.0';

function readBuildId(): string {
  try {
    // 编译产物标识：__dirname = backend/dist/utils → dist/index.js
    return String(Math.floor(fs.statSync(path.resolve(__dirname, '../index.js')).mtimeMs));
  } catch {
    return 'dev'; // tsx 直跑 src 时无 dist，视为开发态不递增
  }
}

function bumpPatch(version: string): string {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return DEFAULT_VERSION;
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** 启动时调用：检测新构建则递增版本，返回当前版本号 */
export async function bumpVersionOnBoot(): Promise<string> {
  try {
    const buildId = readBuildId();
    const rows = await prisma.setting.findMany({ where: { key: { in: [VERSION_KEY, BUILD_KEY] } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value || '']));
    let version = map[VERSION_KEY] || DEFAULT_VERSION;
    if (buildId === 'dev') return version; // 开发态不动版本
    if (map[BUILD_KEY] !== buildId) {
      version = bumpPatch(version);
      await prisma.setting.upsert({ where: { key: VERSION_KEY }, update: { value: version }, create: { key: VERSION_KEY, value: version } });
      await prisma.setting.upsert({ where: { key: BUILD_KEY }, update: { value: buildId }, create: { key: BUILD_KEY, value: buildId } });
      console.log(`🆕 检测到新构建，系统版本: ${version}`);
    }
    return version;
  } catch (e) {
    console.error('bumpVersionOnBoot error:', e);
    return DEFAULT_VERSION;
  }
}

/** 供接口读取当前版本号 */
export async function getSystemVersion(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: VERSION_KEY } });
    return (row && row.value) || DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}
