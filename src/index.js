#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient } from "./figma-client.js";
import { TempManager } from "./temp-manager.js";
import { Logger } from "./logger.js";
import { SvgExporter } from "./svg-exporter.js";
import { simplifyNode, buildComponentMap, generateSummary, toCondensedFormat, inferSemanticRole, buildVariableMap, buildVariableMapFromNodes, toCondensedWithBudget, gradientToCSS, parseEffects, effectsToCSS, fillsToCSS } from "./transformer.js";

const server = new McpServer({
  name: "figma-context-mcp",
  version: "1.0.0",
});

// 初始化临时目录（清空上一次会话数据）
const tempManager = new TempManager();
tempManager.init();

const logger = new Logger(tempManager);
const figma = new FigmaClient(process.env.FIGMA_TOKEN || "");
const svgExporter = new SvgExporter(figma, tempManager);

// 挂载日志钩子
figma.onResponse = (path, params, data) => {
  logger.logRaw("api", { path, params }, data);
};

// Tool: 获取文件结构概览
server.tool(
  "get_file_structure",
  "获取 Figma 文件的页面和顶层 frame 结构概览，适合了解文件整体组织",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
  },
  async ({ fileKey }) => {
    
    const data = await figma.getFile(fileKey, { depth: 2 });
    if (!data) return { content: [{ type: "text", text: "获取文件失败，请检查 token 和 file key" }] };

    const pages = data.document.children.map((page) => ({
      id: page.id,
      name: page.name,
      frames: (page.children || [])
        .filter((c) => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET")
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          width: f.absoluteBoundingBox?.width,
          height: f.absoluteBoundingBox?.height,
        })),
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ fileName: data.name, lastModified: data.lastModified, pages }, null, 2),
      }],
    };
  }
);

// Tool: 获取节点详情（AI 友好格式）
server.tool(
  "get_node",
  "获取指定节点的 AI 友好数据，支持 JSON 和压缩文本两种格式。压缩格式节省 60%+ token，推荐用于代码生成场景",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeId: z.string().describe("节点 ID，格式如 '312:33667' 或 '312-33667'"),
    depth: z.number().optional().default(10).describe("递归深度，默认 10"),
    format: z.enum(["json", "condensed"]).optional().default("condensed").describe("输出格式：json（完整结构化）或 condensed（压缩文本，默认）"),
    maxTokens: z.number().optional().default(4000).describe("压缩格式的最大 token 预算，默认 4000"),
  },
  async ({ fileKey, nodeId, depth, format, maxTokens }) => {
    const normalizedId = nodeId.replace("-", ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]);
    if (!data) return { content: [{ type: "text", text: "获取节点失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text", text: `节点 ${normalizedId} 不存在` }] };

    // 存储原始数据
    tempManager.writeRaw(fileKey, normalizedId, nodeData);

    const simplified = simplifyNode(nodeData.document, 0, depth);
    const summary = generateSummary(simplified);

    // SVG 自动导出
    const exportableNodes = svgExporter.detectExportableNodes(nodeData.document);
    let svgSection = "";
    if (exportableNodes.length > 0) {
      try {
        const svgResults = await svgExporter.exportAndDownload(fileKey, exportableNodes);
        svgSection = svgExporter.formatExportResults(svgResults);
        // 记录图标到汇总索引
        const iconEntries = [];
        for (const [nodeIdKey, svgInfo] of svgResults.entries()) {
          iconEntries.push({
            fileKey,
            nodeId: nodeIdKey,
            name: svgInfo.filename || nodeIdKey,
            svgPath: svgInfo.path || null,
            source: "get_node",
          });
        }
        if (iconEntries.length > 0) tempManager.addIcons(iconEntries);
      } catch (e) {
        svgSection = `\n\n# SVG Export Error\n${e.message}`;
      }
    }

    if (format === "condensed") {
      // 尝试加载 variable 映射以展示 token 绑定
      let variableMap = null;
      try {
        const varsData = await figma.getVariables(fileKey);
        variableMap = buildVariableMap(varsData);
      } catch (e) {
        // Variables API 不可用时，从节点数据中提取变量绑定
        const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
        if (Object.keys(nodeVarMap).length > 0) {
          variableMap = {};
          for (const [id, entry] of Object.entries(nodeVarMap)) {
            variableMap[id] = entry.cssVar;
          }
        }
      }

      const condensed = toCondensedWithBudget(nodeData.document, maxTokens, variableMap);

      // 附加变量定义表
      let varSection = "";
      const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
      if (Object.keys(nodeVarMap).length > 0) {
        const varLines = Object.entries(nodeVarMap).map(
          ([id, entry]) => `  ${entry.cssVar}: ${entry.color};`
        );
        varSection = `\n\n# CSS 变量 (从节点绑定提取)\n:root {\n${varLines.join("\n")}\n}`;
      }

      // 存储优化后数据
      tempManager.writeOptimized(fileKey, normalizedId, { summary, condensed, variables: nodeVarMap });

      return {
        content: [{
          type: "text",
          text: `# 节点概览\n${summary.rootName} (${summary.rootType}) ${summary.rootSize}\n节点总数: ${summary.totalNodes}\n\n# 结构 (压缩格式)\n${condensed}${varSection}${svgSection}`,
        }],
      };
    }

    // JSON 格式也附带变量映射
    const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
    let variables = null;
    if (Object.keys(nodeVarMap).length > 0) {
      variables = nodeVarMap;
    }

    // 存储优化后数据
    tempManager.writeOptimized(fileKey, normalizedId, { summary, tree: simplified, variables });

    // 日志记录
    logger.logOptimized("get_node", { fileKey, nodeId: normalizedId, format }, { summary, variables });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ summary, tree: simplified, variables }, null, 2) + svgSection,
      }],
    };
  }
);

// Tool: 获取组件列表
server.tool(
  "get_components",
  "获取文件中所有组件及其属性定义，适合理解设计系统",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
  },
  async ({ fileKey }) => {
    const data = await figma.getFileComponents(fileKey);
    if (!data) return { content: [{ type: "text", text: "获取组件失败" }] };

    const components = (data.meta?.components || []).map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description || null,
      containingFrame: c.containing_frame?.name || null,
      pageName: c.containing_frame?.pageName || null,
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total: components.length, components }, null, 2),
      }],
    };
  }
);

// Tool: 获取样式（颜色、文字、效果）
server.tool(
  "get_styles",
  "获取文件中定义的所有样式（颜色、文字、效果、网格），适合提取设计 token",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
  },
  async ({ fileKey }) => {
    const data = await figma.getFileStyles(fileKey);
    if (!data) return { content: [{ type: "text", text: "获取样式失败" }] };

    const styles = (data.meta?.styles || []).map((s) => ({
      key: s.key,
      name: s.name,
      type: s.style_type,
      description: s.description || null,
    }));

    const grouped = {};
    for (const s of styles) {
      if (!grouped[s.type]) grouped[s.type] = [];
      grouped[s.type].push(s);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total: styles.length, byType: grouped }, null, 2),
      }],
    };
  }
);

// Tool: 获取 Design Tokens (Variables)
server.tool(
  "get_variables",
  "获取文件的 Variables（设计变量/token），包含颜色、数值等",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
  },
  async ({ fileKey }) => {
    const data = await figma.getVariables(fileKey);
    if (!data) return { content: [{ type: "text", text: "获取 variables 失败" }] };

    const variables = data.meta?.variables || {};
    const collections = data.meta?.variableCollections || {};

    const result = {};
    for (const [collId, coll] of Object.entries(collections)) {
      const collVars = Object.values(variables)
        .filter((v) => v.variableCollectionId === collId)
        .map((v) => ({
          name: v.name,
          type: v.resolvedType,
          values: formatVariableValues(v.valuesByMode, coll.modes),
        }));
      result[coll.name] = { modes: coll.modes.map((m) => m.name), variables: collVars };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool: 获取节点的 CSS（支持递归和 Tailwind 模式）
server.tool(
  "get_node_css",
  "将节点转换为 CSS 或 Tailwind 类名，支持递归生成整个组件树的样式",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeId: z.string().describe("节点 ID"),
    mode: z.enum(["css", "tailwind"]).optional().default("css").describe("输出模式：css（标准 CSS）或 tailwind（Tailwind 类名）"),
    recursive: z.boolean().optional().default(false).describe("是否递归生成子节点样式，默认 false"),
  },
  async ({ fileKey, nodeId, mode, recursive }) => {
    const normalizedId = nodeId.replace("-", ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]);
    if (!data) return { content: [{ type: "text", text: "获取节点失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text", text: `节点 ${normalizedId} 不存在` }] };

    let output;
    if (mode === "tailwind") {
      output = recursive
        ? nodeToTailwindRecursive(nodeData.document, 0)
        : nodeToTailwind(nodeData.document);
    } else {
      output = recursive
        ? nodeToCSSRecursive(nodeData.document, 0)
        : nodeToCSS(nodeData.document);
    }

    return {
      content: [{ type: "text", text: output }],
    };
  }
);

// Tool: 获取图片导出链接
server.tool(
  "get_images",
  "获取指定节点的图片导出 URL（PNG/SVG/PDF）",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeIds: z.array(z.string()).describe("节点 ID 数组"),
    format: z.enum(["png", "svg", "pdf", "jpg"]).optional().default("png"),
    scale: z.number().optional().default(2).describe("导出倍率，默认 2x"),
  },
  async ({ fileKey, nodeIds, format, scale }) => {
    const ids = nodeIds.map((id) => id.replace("-", ":"));
    const data = await figma.getImages(fileKey, ids, format, scale);
    if (!data) return { content: [{ type: "text", text: "获取图片失败" }] };

    return {
      content: [{ type: "text", text: JSON.stringify(data.images || {}, null, 2) }],
    };
  }
);

// Tool: 导出 SVG（独立工具）
server.tool(
  "export_svg",
  "导出指定节点为 SVG 格式，下载 SVG 内容并保存到临时目录。适用于导出图标、矢量图形等",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeIds: z.array(z.string()).describe("要导出的节点 ID 数组"),
  },
  async ({ fileKey, nodeIds }) => {
    const ids = nodeIds.map((id) => id.replace("-", ":"));
    const nodes = ids.map((id) => ({ id, name: id, role: "export" }));

    try {
      const results = await svgExporter.exportAndDownload(fileKey, nodes);
      if (results.size === 0) {
        return { content: [{ type: "text", text: "未能导出任何 SVG，请检查节点 ID 是否正确" }] };
      }

      const output = svgExporter.formatExportResults(results);
      // 记录图标到汇总索引
      const iconEntries = [];
      for (const [nodeIdKey, svgInfo] of results.entries()) {
        iconEntries.push({
          fileKey,
          nodeId: nodeIdKey,
          name: svgInfo.filename || nodeIdKey,
          svgPath: svgInfo.path || null,
          source: "export_svg",
        });
      }
      if (iconEntries.length > 0) tempManager.addIcons(iconEntries);

      logger.logOptimized("export_svg", { fileKey, nodeIds: ids }, { exportedCount: results.size });
      return { content: [{ type: "text", text: output }] };
    } catch (e) {
      return { content: [{ type: "text", text: `SVG 导出失败: ${e.message}` }] };
    }
  }
);

// Tool: 获取组件详情（变体、插槽、结构）
server.tool(
  "get_component_detail",
  "获取单个组件/组件集的完整信息，包含变体属性、内部结构（压缩格式）、描述",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeId: z.string().describe("组件或组件集的节点 ID"),
  },
  async ({ fileKey, nodeId }) => {
    const normalizedId = nodeId.replace("-", ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]);
    if (!data) return { content: [{ type: "text", text: "获取组件失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text", text: `节点 ${normalizedId} 不存在` }] };

    const node = nodeData.document;
    const result = {
      name: node.name,
      type: node.type,
      description: node.description || null,
    };

    // 组件集：提取变体属性
    if (node.type === "COMPONENT_SET" && node.children) {
      const variantMap = {};
      for (const variant of node.children) {
        // Figma 变体命名格式: "Property1=Value1, Property2=Value2"
        const props = variant.name.split(",").map((p) => p.trim());
        for (const prop of props) {
          const [key, value] = prop.split("=").map((s) => s.trim());
          if (key && value) {
            if (!variantMap[key]) variantMap[key] = new Set();
            variantMap[key].add(value);
          }
        }
      }
      result.variants = {};
      for (const [key, values] of Object.entries(variantMap)) {
        result.variants[key] = [...values];
      }
      result.variantCount = node.children.length;

      // 展示第一个变体的内部结构作为参考
      const firstVariant = node.children[0];
      if (firstVariant) {
        result.structure = toCondensedFormat(firstVariant, 0, 5).trim();
      }
    } else if (node.type === "COMPONENT") {
      // 单组件：展示内部结构
      result.structure = toCondensedFormat(node, 0, 6).trim();

      // 提取组件属性定义
      if (node.componentPropertyDefinitions) {
        result.properties = {};
        for (const [key, def] of Object.entries(node.componentPropertyDefinitions)) {
          result.properties[key] = {
            type: def.type,
            defaultValue: def.defaultValue,
            ...(def.variantOptions ? { options: def.variantOptions } : {}),
          };
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// Tool: 一站式代码生成上下文
server.tool(
  "get_page_for_codegen",
  "一站式获取代码生成所需的完整上下文：压缩格式结构 + design tokens + 组件定义 + 颜色/字体规范",
  {
    fileKey: z.string().describe("Figma 文件 Key"),
    nodeId: z.string().describe("目标节点/页面 ID"),
    depth: z.number().optional().default(12).describe("递归深度，默认 12"),
  },
  async ({ fileKey, nodeId, depth }) => {
    const normalizedId = nodeId.replace("-", ":");

    // 并行获取节点数据和 variables
    const [nodeResult, varsResult] = await Promise.all([
      figma.getFileNodes(fileKey, [normalizedId]),
      figma.getVariables(fileKey).catch(() => null),
    ]);

    if (!nodeResult) return { content: [{ type: "text", text: "获取节点失败" }] };
    const nodeData = nodeResult.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text", text: `节点 ${normalizedId} 不存在` }] };

    // 存储原始数据
    tempManager.writeRaw(fileKey, normalizedId, nodeData);

    const node = nodeData.document;

    // 构建 variable 映射
    const variableMap = varsResult ? buildVariableMap(varsResult) : null;

    // 生成压缩格式结构
    const structure = toCondensedFormat(node, 0, depth, variableMap);

    // 提取颜色集合（去重）
    const colors = new Set();
    const fonts = new Set();
    const components = [];
    extractDesignInfo(node, colors, fonts, components);

    // 构建 tokens 摘要
    let tokensSummary = "";
    if (varsResult && varsResult.meta) {
      const collections = varsResult.meta.variableCollections || {};
      const variables = varsResult.meta.variables || {};
      const tokenLines = [];
      for (const [collId, coll] of Object.entries(collections)) {
        const collVars = Object.values(variables)
          .filter((v) => v.variableCollectionId === collId)
          .slice(0, 30); // 限制数量
        tokenLines.push(`## ${coll.name}`);
        for (const v of collVars) {
          const firstMode = Object.values(v.valuesByMode || {})[0];
          tokenLines.push(`  --${v.name}: ${formatValue(firstMode)}`);
        }
      }
      tokensSummary = tokenLines.join("\n");
    }

    // 组装输出
    const output = [
      `# 代码生成上下文`,
      `## 目标: ${node.name} (${node.type})`,
      ``,
      `## 结构`,
      structure,
      `## 使用的颜色`,
      [...colors].join(", "),
      ``,
      `## 使用的字体`,
      [...fonts].join(", "),
      ``,
    ];

    if (components.length > 0) {
      output.push(`## 引用的组件`);
      output.push(components.map((c) => `- ${c.name} (${c.componentId})`).join("\n"));
      output.push(``);
    }

    if (tokensSummary) {
      output.push(`## Design Tokens`);
      output.push(tokensSummary);
    }

    // SVG 自动导出
    const exportableNodes = svgExporter.detectExportableNodes(node);
    if (exportableNodes.length > 0) {
      try {
        const svgResults = await svgExporter.exportAndDownload(fileKey, exportableNodes);
        const svgSection = svgExporter.formatExportResults(svgResults);
        if (svgSection) output.push(svgSection);
        // 记录图标到汇总索引
        const iconEntries = [];
        for (const [nodeIdKey, svgInfo] of svgResults.entries()) {
          iconEntries.push({
            fileKey,
            nodeId: nodeIdKey,
            name: svgInfo.filename || nodeIdKey,
            svgPath: svgInfo.path || null,
            source: "get_page_for_codegen",
          });
        }
        if (iconEntries.length > 0) tempManager.addIcons(iconEntries);
      } catch (e) {
        output.push(`\n## SVG Export Error\n${e.message}`);
      }
    }

    // 存储优化后数据
    tempManager.writeOptimized(fileKey, normalizedId, {
      nodeName: node.name,
      nodeType: node.type,
      structure,
      colors: [...colors],
      fonts: [...fonts],
      components,
      tokens: tokensSummary || null,
    });

    // 日志记录
    logger.logOptimized("get_page_for_codegen", { fileKey, nodeId: normalizedId }, { nodeType: node.type, nodeName: node.name });

    return {
      content: [{ type: "text", text: output.join("\n") }],
    };
  }
);

// --- Helper functions ---

function formatVariableValues(valuesByMode, modes) {
  const result = {};
  for (const [modeId, value] of Object.entries(valuesByMode || {})) {
    const mode = modes.find((m) => m.modeId === modeId);
    const modeName = mode?.name || modeId;
    result[modeName] = formatValue(value);
  }
  return result;
}

function formatValue(value) {
  if (value && typeof value === "object" && "r" in value) {
    const r = Math.round(value.r * 255);
    const g = Math.round(value.g * 255);
    const b = Math.round(value.b * 255);
    const a = value.a !== undefined ? value.a : 1;
    if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  if (value && typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") {
    return `→ ${value.id}`;
  }
  return value;
}

/**
 * 递归提取设计信息：颜色、字体、组件引用
 */
function extractDesignInfo(node, colors, fonts, components) {
  if (!node) return;

  // 提取颜色（纯色 + 渐变）
  const fills = (node.fills || []).filter((f) => f.visible !== false);
  for (const fill of fills) {
    if (fill.type === "SOLID" && fill.color) {
      const r = Math.round(fill.color.r * 255);
      const g = Math.round(fill.color.g * 255);
      const b = Math.round(fill.color.b * 255);
      colors.add(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
    } else if (fill.type?.startsWith("GRADIENT_") && fill.gradientStops) {
      for (const stop of fill.gradientStops) {
        if (stop.color) {
          const r = Math.round(stop.color.r * 255);
          const g = Math.round(stop.color.g * 255);
          const b = Math.round(stop.color.b * 255);
          colors.add(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
        }
      }
    }
  }

  // 提取字体
  if (node.type === "TEXT" && node.style) {
    if (node.style.fontFamily) fonts.add(node.style.fontFamily);
  }

  // 提取组件引用
  if (node.type === "INSTANCE" && node.componentId) {
    components.push({ name: node.name, componentId: node.componentId });
  }

  // 递归子节点
  if (node.children) {
    for (const child of node.children) {
      extractDesignInfo(child, colors, fonts, components);
    }
  }
}

function nodeToCSS(node) {
  const lines = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    lines.push(`width: ${bbox.width}px;`);
    lines.push(`height: ${bbox.height}px;`);
  }

  // Background (支持纯色 + 渐变)
  const fills = (node.fills || []).filter((f) => f.visible !== false);
  const fillCSS = fillsToCSS(fills);
  for (const [prop, value] of Object.entries(fillCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  // Effects (阴影、模糊)
  const effectCSS = effectsToCSS(node.effects);
  for (const [prop, value] of Object.entries(effectCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  // Border（支持纯色和渐变描边）
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokes.length > 0) {
    const solidStrokes = strokes.filter((s) => s.type === "SOLID");
    const gradientStrokes = strokes.filter((s) => s.type?.startsWith("GRADIENT_"));

    if (solidStrokes.length > 0 && solidStrokes[0].color) {
      const c = solidStrokes[0].color;
      const hex = `#${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      lines.push(`border: ${node.strokeWeight || 1}px solid ${hex};`);
    } else if (gradientStrokes.length > 0) {
      const gradCSS = gradientToCSS(gradientStrokes[0]);
      if (gradCSS) {
        lines.push(`border: ${node.strokeWeight || 1}px solid transparent;`);
        lines.push(`border-image: ${gradCSS} 1;`);
      }
    }
  }

  // Border radius
  if (node.cornerRadius) {
    lines.push(`border-radius: ${node.cornerRadius}px;`);
  }

  // Layout
  if (node.layoutMode === "HORIZONTAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: row;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  } else if (node.layoutMode === "VERTICAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: column;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  }

  // Padding
  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    lines.push(`padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px;`);
  }

  // Text
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontFamily) lines.push(`font-family: "${s.fontFamily}";`);
    if (s.fontSize) lines.push(`font-size: ${s.fontSize}px;`);
    if (s.fontWeight) lines.push(`font-weight: ${s.fontWeight};`);
    if (s.lineHeightPx) lines.push(`line-height: ${s.lineHeightPx}px;`);
    if (s.letterSpacing) lines.push(`letter-spacing: ${s.letterSpacing}px;`);
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    lines.push(`opacity: ${node.opacity};`);
  }

  return `/* ${node.name} */\n.${toCSSClass(node.name)} {\n  ${lines.join("\n  ")}\n}`;
}

function toCSSClass(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "element";
}

/**
 * 递归生成整个组件树的 CSS
 */
function nodeToCSSRecursive(node, depth = 0, maxDepth = 8) {
  if (!node || depth > maxDepth) return "";
  if (node.visible === false) return "";

  let output = nodeToCSS(node) + "\n\n";

  if (node.children) {
    for (const child of node.children) {
      if (child.visible === false) continue;
      output += nodeToCSSRecursive(child, depth + 1, maxDepth);
    }
  }

  return output;
}

/**
 * 单节点转 Tailwind 类名
 */
function nodeToTailwind(node) {
  const classes = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    classes.push(`w-[${Math.round(bbox.width)}px]`);
    classes.push(`h-[${Math.round(bbox.height)}px]`);
  }

  // Background (支持纯色 + 渐变)
  const allFills = (node.fills || []).filter((f) => f.visible !== false);
  const gradientFills = allFills.filter((f) => f.type?.startsWith("GRADIENT_"));
  const solidFills = allFills.filter((f) => f.type === "SOLID");

  if (gradientFills.length > 0) {
    const cssGradient = gradientToCSS(gradientFills[0]);
    if (cssGradient) classes.push(`bg-[${cssGradient.replace(/\s+/g, "_")}]`);
  } else if (solidFills.length > 0 && solidFills[0].color) {
    const c = solidFills[0].color;
    const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
    classes.push(`bg-[#${hex}]`);
  }

  // Effects (阴影、模糊)
  const effects = parseEffects(node.effects);
  if (effects) {
    for (const effect of effects) {
      if (effect.type === "drop-shadow") {
        classes.push(`shadow-[${effect.offset.x}px_${effect.offset.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "inner-shadow") {
        classes.push(`shadow-[inset_${effect.offset.x}px_${effect.offset.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "blur") {
        classes.push(`blur-[${effect.radius}px]`);
      } else if (effect.type === "backdrop-blur") {
        classes.push(`backdrop-blur-[${effect.radius}px]`);
      }
    }
  }

  // Border（支持纯色和渐变描边）
  const strokesArr = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokesArr.length > 0) {
    const solidStrokesArr = strokesArr.filter((s) => s.type === "SOLID");
    const gradStrokesArr = strokesArr.filter((s) => s.type?.startsWith("GRADIENT_"));

    if (solidStrokesArr.length > 0 && solidStrokesArr[0].color) {
      const c = solidStrokesArr[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`border`);
      classes.push(`border-[#${hex}]`);
      if (node.strokeWeight && node.strokeWeight !== 1) {
        classes.push(`border-[${node.strokeWeight}px]`);
      }
    } else if (gradStrokesArr.length > 0) {
      const gradCSS = gradientToCSS(gradStrokesArr[0]);
      if (gradCSS) {
        classes.push(`border`);
        classes.push(`border-transparent`);
        classes.push(`[border-image:${gradCSS.replace(/\s+/g, "_")}_1]`);
      }
    }
  }

  // Border radius
  if (node.cornerRadius) {
    classes.push(`rounded-[${node.cornerRadius}px]`);
  }

  // Layout
  if (node.layoutMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  } else if (node.layoutMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  }

  // Alignment
  if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
  else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
  else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");
  if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
  else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");

  // Padding
  const pt = node.paddingTop || 0;
  const pr = node.paddingRight || 0;
  const pb = node.paddingBottom || 0;
  const pl = node.paddingLeft || 0;
  if (pt === pr && pr === pb && pb === pl && pt > 0) {
    classes.push(`p-[${pt}px]`);
  } else {
    if (pt === pb && pt > 0) classes.push(`py-[${pt}px]`);
    else {
      if (pt > 0) classes.push(`pt-[${pt}px]`);
      if (pb > 0) classes.push(`pb-[${pb}px]`);
    }
    if (pl === pr && pl > 0) classes.push(`px-[${pl}px]`);
    else {
      if (pl > 0) classes.push(`pl-[${pl}px]`);
      if (pr > 0) classes.push(`pr-[${pr}px]`);
    }
  }

  // Text
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontSize) classes.push(`text-[${s.fontSize}px]`);
    if (s.fontWeight) {
      const weightMap = { 100: "thin", 200: "extralight", 300: "light", 400: "normal", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };
      classes.push(`font-${weightMap[s.fontWeight] || `[${s.fontWeight}]`}`);
    }
    if (s.lineHeightPx && s.fontSize) {
      classes.push(`leading-[${Math.round(s.lineHeightPx)}px]`);
    }
    // Text color
    const textFills = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0 && textFills[0].color) {
      const c = textFills[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`text-[#${hex}]`);
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    classes.push(`opacity-[${Math.round(node.opacity * 100)}]`);
  }

  const text = node.type === "TEXT" ? (node.characters || "").slice(0, 50) : "";
  return `/* ${node.name} */\n<div class="${classes.join(" ")}">${text}</div>`;
}

/**
 * 递归生成 Tailwind 组件结构（带缩进的 JSX 风格）
 */
function nodeToTailwindRecursive(node, depth = 0, maxDepth = 8) {
  if (!node || depth > maxDepth) return "";
  if (node.visible === false) return "";

  const indent = "  ".repeat(depth);
  const classes = getTailwindClasses(node);
  const tag = getHtmlTag(node);
  const text = node.type === "TEXT" ? (node.characters || "").slice(0, 80) : "";

  if (!node.children || node.children.length === 0) {
    if (node.type === "TEXT") {
      return `${indent}<${tag} class="${classes}">${text}</${tag}>\n`;
    }
    return `${indent}<${tag} class="${classes}" />\n`;
  }

  let output = `${indent}<${tag} class="${classes}">\n`;
  for (const child of node.children) {
    if (child.visible === false) continue;
    output += nodeToTailwindRecursive(child, depth + 1, maxDepth);
  }
  output += `${indent}</${tag}>\n`;
  return output;
}

function getHtmlTag(node) {
  const semantic = inferSemanticRole(node);
  if (semantic) return semantic.html;
  if (node.type === "TEXT") return "span";
  return "div";
}

function getTailwindClasses(node) {
  const classes = [];

  // Layout
  if (node.layoutMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  } else if (node.layoutMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  }

  // Alignment
  if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
  else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
  else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");
  if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
  else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");

  // Size
  const bbox = node.absoluteBoundingBox;
  if (bbox) {
    if (node.layoutGrow === 1) classes.push("flex-1");
    else classes.push(`w-[${Math.round(bbox.width)}px]`);
    classes.push(`h-[${Math.round(bbox.height)}px]`);
  }

  // Background (支持纯色 + 渐变)
  const fills = (node.fills || []).filter((f) => f.visible !== false);
  const gradFills = fills.filter((f) => f.type?.startsWith("GRADIENT_"));
  const solidFillsInner = fills.filter((f) => f.type === "SOLID");

  if (node.type !== "TEXT") {
    if (gradFills.length > 0) {
      const cssGradient = gradientToCSS(gradFills[0]);
      if (cssGradient) classes.push(`bg-[${cssGradient.replace(/\s+/g, "_")}]`);
    } else if (solidFillsInner.length > 0 && solidFillsInner[0].color) {
      const c = solidFillsInner[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`bg-[#${hex}]`);
    }
  }

  // Effects (阴影、模糊)
  const efx = parseEffects(node.effects);
  if (efx) {
    for (const effect of efx) {
      if (effect.type === "drop-shadow") {
        classes.push(`shadow-[${effect.offset.x}px_${effect.offset.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "inner-shadow") {
        classes.push(`shadow-[inset_${effect.offset.x}px_${effect.offset.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "blur") {
        classes.push(`blur-[${effect.radius}px]`);
      } else if (effect.type === "backdrop-blur") {
        classes.push(`backdrop-blur-[${effect.radius}px]`);
      }
    }
  }

  // Border radius
  if (node.cornerRadius) classes.push(`rounded-[${node.cornerRadius}px]`);

  // Padding
  const pt = node.paddingTop || 0;
  const pr = node.paddingRight || 0;
  const pb = node.paddingBottom || 0;
  const pl = node.paddingLeft || 0;
  if (pt === pr && pr === pb && pb === pl && pt > 0) {
    classes.push(`p-[${pt}px]`);
  } else {
    if (pt === pb && pt > 0) classes.push(`py-[${pt}px]`);
    else { if (pt > 0) classes.push(`pt-[${pt}px]`); if (pb > 0) classes.push(`pb-[${pb}px]`); }
    if (pl === pr && pl > 0) classes.push(`px-[${pl}px]`);
    else { if (pl > 0) classes.push(`pl-[${pl}px]`); if (pr > 0) classes.push(`pr-[${pr}px]`); }
  }

  // Text styles
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontSize) classes.push(`text-[${s.fontSize}px]`);
    if (s.fontWeight && s.fontWeight !== 400) classes.push(`font-[${s.fontWeight}]`);
    const textFills = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0 && textFills[0].color) {
      const c = textFills[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`text-[#${hex}]`);
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    classes.push(`opacity-[${Math.round(node.opacity * 100)}]`);
  }

  return classes.join(" ");
}

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
