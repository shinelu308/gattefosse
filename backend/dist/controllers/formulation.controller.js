"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFormulations = listFormulations;
exports.getFormulation = getFormulation;
exports.createFormulation = createFormulation;
exports.updateFormulation = updateFormulation;
exports.deleteFormulation = deleteFormulation;
exports.batchDeleteFormulations = batchDeleteFormulations;
const prisma_1 = require("../utils/prisma");
const response_1 = require("../utils/response");
const FORMULATION_INCLUDE = {
    createdBy: { select: { id: true, fullName: true } },
};
/**
 * 获取配方列表 - 支持多维标签筛选 + 分页 + 搜索
 */
async function listFormulations(req, res) {
    try {
        const { page = '1', limit = '20', keyword, application, form, claim, naturalityIndex, ingredient, isPublished, } = req.query;
        const pageNum = Math.max(1, parseInt(String(page)));
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
        const where = {};
        if (keyword) {
            const kw = String(keyword);
            where.OR = [
                { name: { contains: kw } },
                { code: { contains: kw } },
                { description: { contains: kw } },
            ];
        }
        const tagFilters = [
            ['applicationTag', application],
            ['formTag', form],
            ['claimTag', claim],
            ['conceptTag', ingredient],
        ];
        for (const [field, val] of tagFilters) {
            if (val) {
                const vals = String(val).split(',').filter(Boolean);
                if (vals.length > 0) {
                    where[field] = { contains: vals[0] };
                }
            }
        }
        if (naturalityIndex) {
            where.naturalityIndex = String(naturalityIndex);
        }
        if (isPublished !== undefined && isPublished !== '') {
            where.isPublished = String(isPublished) === 'true';
        }
        const [total, items] = await Promise.all([
            prisma_1.prisma.formulation.count({ where }),
            prisma_1.prisma.formulation.findMany({
                where,
                include: FORMULATION_INCLUDE,
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
                orderBy: { sortOrder: 'asc' },
            }),
        ]);
        return res.json((0, response_1.success)((0, response_1.paginate)(items.map(formatFormulation), total, pageNum, limitNum), '获取成功'));
    }
    catch (error) {
        console.error('获取配方列表失败:', error);
        return res.status(500).json((0, response_1.fail)('获取配方列表失败'));
    }
}
/**
 * 获取配方详情
 */
async function getFormulation(req, res) {
    try {
        const id = parseInt(req.params.id);
        const item = await prisma_1.prisma.formulation.findUnique({
            where: { id },
            include: {
                ...FORMULATION_INCLUDE,
                docFormulations: {
                    include: { document: true },
                },
            },
        });
        if (!item) {
            return res.status(404).json((0, response_1.fail)('配方不存在'));
        }
        return res.json((0, response_1.success)(formatFormulation(item), '获取成功'));
    }
    catch (error) {
        console.error('获取配方详情失败:', error);
        return res.status(500).json((0, response_1.fail)('获取配方详情失败'));
    }
}
/**
 * 创建配方
 */
async function createFormulation(req, res) {
    try {
        const { name, code, description, imageUrl, pdfPath, applicationTag, formTag, claimTag, naturalityIndex, conceptTag, compositionText, preparationSteps, pictos, sortOrder, isPublished, videoUrl, videoSectionTitle, } = req.body;
        if (!name) {
            return res.status(400).json((0, response_1.fail)('配方名称不能为空'));
        }
        const item = await prisma_1.prisma.formulation.create({
            data: {
                name,
                code: code || null,
                description: description || null,
                imageUrl: imageUrl || null,
                pdfPath: pdfPath || null,
                applicationTag: Array.isArray(applicationTag) ? applicationTag.join(',') : (applicationTag || ''),
                formTag: Array.isArray(formTag) ? formTag.join(',') : (formTag || ''),
                claimTag: Array.isArray(claimTag) ? claimTag.join(',') : (claimTag || ''),
                naturalityIndex: naturalityIndex || null,
                conceptTag: Array.isArray(conceptTag) ? conceptTag.join(',') : (conceptTag || ''),
                compositionText: compositionText || null,
                preparationSteps: preparationSteps || null,
                pictos: pictos || '[]',
                sortOrder: sortOrder || 0,
                isPublished: isPublished || false,
                videoUrl: videoUrl || null,
                videoSectionTitle: videoSectionTitle || null,
                createdById: req.user?.userId || null,
            },
            include: FORMULATION_INCLUDE,
        });
        return res.json((0, response_1.success)(formatFormulation(item), '创建成功'));
    }
    catch (error) {
        console.error('创建配方失败:', error);
        return res.status(500).json((0, response_1.fail)('创建配方失败'));
    }
}
/**
 * 更新配方
 */
async function updateFormulation(req, res) {
    try {
        const id = parseInt(req.params.id);
        const existing = await prisma_1.prisma.formulation.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json((0, response_1.fail)('配方不存在'));
        }
        const { name, code, description, imageUrl, pdfPath, applicationTag, formTag, claimTag, naturalityIndex, conceptTag, compositionText, preparationSteps, pictos, sortOrder, isPublished, videoUrl, videoSectionTitle, } = req.body;
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (code !== undefined)
            updateData.code = code || null;
        if (description !== undefined)
            updateData.description = description || null;
        if (imageUrl !== undefined)
            updateData.imageUrl = imageUrl || null;
        if (pdfPath !== undefined)
            updateData.pdfPath = pdfPath || null;
        if (applicationTag !== undefined)
            updateData.applicationTag = Array.isArray(applicationTag) ? applicationTag.join(',') : applicationTag;
        if (formTag !== undefined)
            updateData.formTag = Array.isArray(formTag) ? formTag.join(',') : formTag;
        if (claimTag !== undefined)
            updateData.claimTag = Array.isArray(claimTag) ? claimTag.join(',') : claimTag;
        if (naturalityIndex !== undefined)
            updateData.naturalityIndex = naturalityIndex || null;
        if (conceptTag !== undefined)
            updateData.conceptTag = Array.isArray(conceptTag) ? conceptTag.join(',') : conceptTag;
        if (compositionText !== undefined)
            updateData.compositionText = compositionText || null;
        if (preparationSteps !== undefined)
            updateData.preparationSteps = preparationSteps || null;
        if (pictos !== undefined)
            updateData.pictos = pictos || '[]';
        if (sortOrder !== undefined)
            updateData.sortOrder = sortOrder;
        if (isPublished !== undefined)
            updateData.isPublished = isPublished;
        if (videoUrl !== undefined)
            updateData.videoUrl = videoUrl || null;
        if (videoSectionTitle !== undefined)
            updateData.videoSectionTitle = videoSectionTitle || null;
        const item = await prisma_1.prisma.formulation.update({
            where: { id },
            data: updateData,
            include: FORMULATION_INCLUDE,
        });
        return res.json((0, response_1.success)(formatFormulation(item), '更新成功'));
    }
    catch (error) {
        console.error('更新配方失败:', error);
        return res.status(500).json((0, response_1.fail)('更新配方失败'));
    }
}
/**
 * 删除配方
 */
async function deleteFormulation(req, res) {
    try {
        const id = parseInt(req.params.id);
        const existing = await prisma_1.prisma.formulation.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json((0, response_1.fail)('配方不存在'));
        }
        await prisma_1.prisma.formulation.delete({ where: { id } });
        return res.json((0, response_1.success)(null, '删除成功'));
    }
    catch (error) {
        console.error('删除配方失败:', error);
        return res.status(500).json((0, response_1.fail)('删除配方失败'));
    }
}
/**
 * 批量删除配方
 */
async function batchDeleteFormulations(req, res) {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json((0, response_1.fail)('请选择要删除的配方'));
        }
        await prisma_1.prisma.formulation.deleteMany({
            where: { id: { in: ids } },
        });
        return res.json((0, response_1.success)(null, `成功删除 ${ids.length} 个配方`));
    }
    catch (error) {
        console.error('批量删除失败:', error);
        return res.status(500).json((0, response_1.fail)('批量删除失败'));
    }
}
/** 逗号分隔字符串转数组 */
function splitTags(str) {
    if (!str)
        return [];
    return str.split(',').map((s) => s.trim()).filter(Boolean);
}
/** 格式化配方输出 */
function formatFormulation(item) {
    return {
        ...item,
        applicationTag: splitTags(item.applicationTag),
        formTag: splitTags(item.formTag),
        claimTag: splitTags(item.claimTag),
        conceptTag: splitTags(item.conceptTag),
    };
}
//# sourceMappingURL=formulation.controller.js.map