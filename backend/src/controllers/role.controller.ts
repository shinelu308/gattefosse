import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 角色管理接口（后台「角色管理」页专用，2026-10-13）
 * ---------------------------------------------------------------------------
 * roles 表 = 员工可分配角色字典 + 每角色的模块权限矩阵（permissions JSON）。
 * - super_admin：系统内置，完全锁定（不可编辑/删除，权限恒为全 1）
 * - editor：系统内置，可改权限矩阵，但 key/name 不可改
 * - 自定义角色：完整 CRUD；删除前校验没有员工引用
 * permissions JSON：{ "<moduleKey>": { view,create,edit,delete }, ... }
 *   当前生效维度 = view（主框架 canModule 经 settings.role_permissions 投影）。
 */

// 角色标识 key 规则：字母开头，字母/数字/下划线，≤32 位
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
// 保留 key：user 是 C 端会员角色（不在 roles 表内），super_admin 由内置种子管理
const RESERVED_KEYS = ['user'];

/** 校验权限矩阵形状：{ mod: { view:create:edit:delete } }，未知字段剔除 */
function sanitizePermissions(input: unknown): Record<string, { view: number; create: number; edit: number; delete: number }> {
  const out: Record<string, { view: number; create: number; edit: number; delete: number }> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [mod, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]*$/i.test(mod) || typeof v !== 'object' || v === null) continue;
    const src = v as Record<string, unknown>;
    out[mod] = {
      view: src.view ? 1 : 0,
      create: src.create ? 1 : 0,
      edit: src.edit ? 1 : 0,
      delete: src.delete ? 1 : 0,
    };
  }
  return out;
}

function parseRole(row: {
  id: number; key: string; name: string; description: string | null;
  permissions: string; sort: number; builtin: boolean; createdAt: Date; updatedAt: Date;
}) {
  let permissions: unknown = {};
  try { permissions = JSON.parse(row.permissions || '{}'); } catch (e) { permissions = {}; }
  return { ...row, permissions };
}

/**
 * 角色列表（含每角色员工数）
 */
export async function listRoles(_req: Request, res: Response) {
  try {
    const roles = await prisma.role.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    // 员工数 = users 表里 role=key 且非 C 端会员的账号数（roles 表里不会有 'user'，防御性排除）
    const counts = await prisma.user.groupBy({
      by: ['role'],
      _count: { _all: true },
      where: { role: { not: 'user' } },
    });
    const countMap = new Map(counts.map((c) => [c.role, c._count._all]));
    return res.json(success(roles.map((r) => ({ ...parseRole(r), memberCount: countMap.get(r.key) || 0 })), '获取成功'));
  } catch (error) {
    console.error('获取角色列表失败:', error);
    return res.status(500).json(fail('获取角色列表失败'));
  }
}

/**
 * 新增自定义角色
 */
export async function createRole(req: Request, res: Response) {
  try {
    const { key, name, description, permissions, sort } = req.body;
    const keyStr = String(key || '').trim();
    const nameStr = String(name || '').trim();
    if (!KEY_RE.test(keyStr)) {
      return res.status(400).json(fail('角色标识须为字母开头，仅含字母/数字/下划线（≤32 位）'));
    }
    if (RESERVED_KEYS.includes(keyStr.toLowerCase())) {
      return res.status(400).json(fail('该角色标识为系统保留，不可使用'));
    }
    if (!nameStr) {
      return res.status(400).json(fail('角色名称为必填项'));
    }
    const dupKey = await prisma.role.findUnique({ where: { key: keyStr } });
    if (dupKey) {
      return res.status(400).json(fail('角色标识已存在'));
    }
    const dupName = await prisma.role.findFirst({ where: { name: nameStr } });
    if (dupName) {
      return res.status(400).json(fail('角色名称已存在'));
    }
    const role = await prisma.role.create({
      data: {
        key: keyStr,
        name: nameStr,
        description: description ? String(description).trim() : null,
        permissions: JSON.stringify(sanitizePermissions(permissions)),
        sort: Number.isFinite(Number(sort)) ? Number(sort) : (await prisma.role.count()) * 10 + 10,
        builtin: false,
      },
    });
    return res.json(success(parseRole(role), '角色创建成功'));
  } catch (error) {
    console.error('创建角色失败:', error);
    return res.status(500).json(fail('创建角色失败'));
  }
}

/**
 * 更新角色
 * - 内置角色：key/name 不可改；super_admin 完全锁定，editor 仅可改权限矩阵与描述
 */
export async function updateRole(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('角色不存在'));
    }
    if (existing.key === 'super_admin') {
      return res.status(403).json(fail('超级管理员为系统内置角色，不可修改'));
    }

    const { name, description, permissions, sort } = req.body;
    const updateData: Record<string, unknown> = {};

    if (!existing.builtin) {
      // 自定义角色：名称可改（查重）
      if (name !== undefined) {
        const nameStr = String(name).trim();
        if (!nameStr) return res.status(400).json(fail('角色名称为必填项'));
        const dupName = await prisma.role.findFirst({ where: { name: nameStr, id: { not: id } } });
        if (dupName) return res.status(400).json(fail('角色名称已存在'));
        updateData.name = nameStr;
      }
      if (sort !== undefined && Number.isFinite(Number(sort))) updateData.sort = Number(sort);
    }
    if (description !== undefined) updateData.description = description ? String(description).trim() : null;
    if (permissions !== undefined) updateData.permissions = JSON.stringify(sanitizePermissions(permissions));

    const role = await prisma.role.update({ where: { id }, data: updateData });
    return res.json(success(parseRole(role), '角色更新成功'));
  } catch (error) {
    console.error('更新角色失败:', error);
    return res.status(500).json(fail('更新角色失败'));
  }
}

/**
 * 删除角色（内置角色不可删；仍有员工引用时不可删）
 */
export async function deleteRole(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('角色不存在'));
    }
    if (existing.builtin) {
      return res.status(403).json(fail('系统内置角色不可删除'));
    }
    const refCount = await prisma.user.count({ where: { role: existing.key } });
    if (refCount > 0) {
      return res.status(400).json(fail(`仍有 ${refCount} 名员工使用该角色，请先调整其角色后再删除`));
    }
    await prisma.role.delete({ where: { id } });
    return res.json(success(null, '角色删除成功'));
  } catch (error) {
    console.error('删除角色失败:', error);
    return res.status(500).json(fail('删除角色失败'));
  }
}
