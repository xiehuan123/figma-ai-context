#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient } from "./figma-client.js";
import { TempManager } from "./temp-manager.js";
import { Logger } from "./logger.js";
import { SvgExporter } from "./svg-exporter.js";
import { simplifyNode, buildComponentMap, generateSummary, toCondensedFormat, inferSemanticRole, buildVariableMap, buildVariableMapFromNodes, toCondensedWithBudget, gradientToCSS, parseEffects, effectsToCSS, fillsToCSS, colorToString } from "./transformer.js";

const server = new McpServer({
  name: "figma-ai-context",
  version: "1.0.0",
});

const tempManager = new TempManager();
tempManager.init();

const logger = new Logger(tempManager);
const figma = new FigmaClient(process.env.FIGMA_TOKEN || "");
const svgExporter = new SvgExporter(figma, tempManager);

figma.onResponse = (path, params, data) => {
  logger.logRaw("api", { path, params }, data);
};

server.registerTool(
  "get_file_structure",
  {
    description: "获取 Figma 文件的页面和顶层 frame 结构概览，适合了解文件整体组织",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
    },
  },
  async ({ fileKey }) => {
    const data = await figma.getFile(fileKey, { depth: 2 }) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取文件失败，请检查 token 和 file key" }] };

    const pages = data.document.children.map((page: any) => ({
      id: page.id,
      name: page.name,
      frames: (page.children || [])
        .filter((c: any) => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET")
        .map((f: any) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          width: f.absoluteBoundingBox?.width,
          height: f.absoluteBoundingBox?.height,
        })),
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ fileName: data.name, lastModified: data.lastModified, pages }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "get_texts",
  {
    description: "从 Figma 地址或文件中提取所有文字内容，支持直接传入 Figma URL",
    inputSchema: {
      url: z.string().optional().describe("Figma 文件/节点 URL，如 https://www.figma.com/design/xxx/yyy?node-id=1-2"),
      fileKey: z.string().optional().describe("Figma 文件 Key（与 url 二选一）"),
      nodeId: z.string().optional().describe("节点 ID，不传则获取整个文件的文字"),
      depth: z.number().optional().default(20).describe("递归深度，默认 20"),
    },
  },
  async ({ url, fileKey, nodeId, depth }) => {
    let resolvedFileKey = fileKey;
    let resolvedNodeId = nodeId;

    if (url) {
      const parsed = parseFigmaUrl(url);
      if (!parsed) {
        return { content: [{ type: "text" as const, text: "无法解析 Figma URL，请确认格式正确" }] };
      }
      resolvedFileKey = parsed.fileKey;
      resolvedNodeId = parsed.nodeId || resolvedNodeId;
    }

    if (!resolvedFileKey) {
      return { content: [{ type: "text" as const, text: "请提供 Figma URL 或 fileKey" }] };
    }

    let rootNode: any;

    if (resolvedNodeId) {
      const normalizedId = resolvedNodeId.replace("-", ":");
      const data = await figma.getFileNodes(resolvedFileKey, [normalizedId]) as any;
      if (!data) return { content: [{ type: "text" as const, text: "获取节点失败" }] };
      const nodeData = data.nodes[normalizedId];
      if (!nodeData) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };
      rootNode = nodeData.document;
    } else {
      const data = await figma.getFile(resolvedFileKey, { depth }) as any;
      if (!data) return { content: [{ type: "text" as const, text: "获取文件失败，请检查 token 和 file key" }] };
      rootNode = data.document;
    }

    const texts = extractAllTexts(rootNode, depth);

    if (texts.length === 0) {
      return { content: [{ type: "text" as const, text: "未找到任何文字内容" }] };
    }

    const output = texts.map((t) =>
      `[${t.path}] ${t.text}${t.style ? ` (${t.style})` : ""}`
    ).join("\n");

    return {
      content: [{
        type: "text" as const,
        text: `# 文字内容 (共 ${texts.length} 条)\n\n${output}`,
      }],
    };
  }
);

server.registerTool(
  "get_node",
  {
    description: "获取指定节点的 AI 友好数据，支持 JSON 和压缩文本两种格式。压缩格式节省 60%+ token，推荐用于代码生成场景",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeId: z.string().describe("节点 ID，格式如 '312:33667' 或 '312-33667'"),
      depth: z.number().optional().default(10).describe("递归深度，默认 10"),
      format: z.enum(["json", "condensed"]).optional().default("condensed").describe("输出格式：json（完整结构化）或 condensed（压缩文本，默认）"),
      maxTokens: z.number().optional().default(4000).describe("压缩格式的最大 token 预算，默认 4000"),
    },
  },
  async ({ fileKey, nodeId, depth, format, maxTokens }) => {
    const normalizedId = nodeId.replace("-", ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取节点失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };

    tempManager.writeRaw(fileKey, normalizedId, nodeData);

    const simplified = simplifyNode(nodeData.document, 0, depth);
    const summary = generateSummary(simplified);

    const exportableNodes = svgExporter.detectExportableNodes(nodeData.document);
    let svgSection = "";
    if (exportableNodes.length > 0) {
      try {
        const svgResults = await svgExporter.exportNodes(fileKey, exportableNodes);
        svgSection = svgExporter.formatExportResults(svgResults);
        const iconEntries: any[] = [];
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
      } catch (e: any) {
        svgSection = `\n\n# SVG Export Error\n${e.message}`;
      }
    }

    if (format === "condensed") {
      let variableMap: Record<string, string> | null = null;
      try {
        const varsData = await figma.getVariables(fileKey);
        variableMap = buildVariableMap(varsData);
      } catch (e) {
        const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
        if (Object.keys(nodeVarMap).length > 0) {
          variableMap = {};
          for (const [id, entry] of Object.entries(nodeVarMap)) {
            variableMap[id] = entry.cssVar;
          }
        }
      }

      const condensed = toCondensedWithBudget(nodeData.document, maxTokens, variableMap);

      let varSection = "";
      const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
      if (Object.keys(nodeVarMap).length > 0) {
        const varLines = Object.entries(nodeVarMap).map(
          ([id, entry]) => `  ${entry.cssVar}: ${entry.color};`
        );
        varSection = `\n\n# CSS 变量 (从节点绑定提取)\n:root {\n${varLines.join("\n")}\n}`;
      }

      tempManager.writeOptimized(fileKey, normalizedId, { summary, condensed, variables: nodeVarMap });

      return {
        content: [{
          type: "text" as const,
          text: `# 节点概览\n${summary.rootName} (${summary.rootType}) ${summary.rootSize}\n节点总数: ${summary.totalNodes}\n\n# 结构 (压缩格式)\n${condensed}${varSection}${svgSection}`,
        }],
      };
    }

    const nodeVarMap = buildVariableMapFromNodes(nodeData.document);
    let variables: any = null;
    if (Object.keys(nodeVarMap).length > 0) {
      variables = nodeVarMap;
    }

    tempManager.writeOptimized(fileKey, normalizedId, { summary, tree: simplified, variables });
    logger.logOptimized("get_node", { fileKey, nodeId: normalizedId, format }, { summary, variables });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ summary, tree: simplified, variables }, null, 2) + svgSection,
      }],
    };
  }
);

// PLACEHOLDER_INDEX_2

server.registerTool(
  "get_components",
  {
    description: "获取文件中所有组件的列表和基本信息",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
    },
  },
  async ({ fileKey }) => {
    const data = await figma.getFile(fileKey, { depth: 2 }) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取文件失败" }] };

    const componentMap = buildComponentMap(data.document);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(componentMap, null, 2) }],
    };
  }
);

server.registerTool(
  "get_variables",
  {
    description: "获取文件的 Variables（设计变量/token），包含颜色、数值等",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
    },
  },
  async ({ fileKey }) => {
    const data = await figma.getVariables(fileKey) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取 variables 失败" }] };

    const variables = data.meta?.variables || {};
    const collections = data.meta?.variableCollections || {};

    const result: Record<string, any> = {};
    for (const [collId, coll] of Object.entries(collections) as [string, any][]) {
      const collVars = Object.values(variables)
        .filter((v: any) => v.variableCollectionId === collId)
        .map((v: any) => ({
          name: v.name,
          type: v.resolvedType,
          values: formatVariableValues(v.valuesByMode, coll.modes),
        }));
      result[coll.name] = { modes: coll.modes.map((m: any) => m.name), variables: collVars };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_node_css",
  {
    description: "将节点转换为 CSS 或 Tailwind 类名，支持递归生成整个组件树的样式",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeId: z.string().describe("节点 ID"),
      mode: z.enum(["css", "tailwind"]).optional().default("css").describe("输出模式：css（标准 CSS）或 tailwind（Tailwind 类名）"),
      recursive: z.boolean().optional().default(false).describe("是否递归生成子节点样式，默认 false"),
    },
  },
  async ({ fileKey, nodeId, mode, recursive }) => {
    const normalizedId = nodeId.replace("-", ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取节点失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };

    let output: string;
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
      content: [{ type: "text" as const, text: output }],
    };
  }
);

server.registerTool(
  "get_images",
  {
    description: "获取指定节点的图片导出 URL（PNG/SVG/PDF）",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeIds: z.array(z.string()).describe("节点 ID 数组"),
      format: z.enum(["png", "svg", "pdf", "jpg"]).optional().default("png"),
      scale: z.number().optional().default(2).describe("导出倍率，默认 2x"),
    },
  },
  async ({ fileKey, nodeIds, format, scale }) => {
    const ids = nodeIds.map((id) => id.replace("-", ":"));
    const data = await figma.getImages(fileKey, ids, format, scale) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取图片失败" }] };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.images || {}, null, 2) }],
    };
  }
);

server.registerTool(
  "export_svg",
  {
    description: "导出指定节点为 SVG 格式，下载 SVG 内容并保存到临时目录。适用于导出图标、矢量图形等",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeIds: z.array(z.string()).describe("要导出的节点 ID 数组"),
    },
  },
  async ({ fileKey, nodeIds }) => {
    const ids = nodeIds.map((id) => id.replace("-", ":"));
    const nodes = ids.map((id) => ({ id, name: id, role: "export" }));

    try {
      const results = await svgExporter.exportNodes(fileKey, nodes);
      if (results.size === 0) {
        return { content: [{ type: "text" as const, text: "未能导出任何 SVG，请检查节点 ID 是否正确" }] };
      }

      const output = svgExporter.formatExportResults(results);
      const iconEntries: any[] = [];
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
      return { content: [{ type: "text" as const, text: output }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `SVG 导出失败: ${e.message}` }] };
    }
  }
);

// PLACEHOLDER_INDEX_3

server.registerTool(
  "get_icons_index",
  {
    description: "获取当前会话中已导出的所有图标/SVG 的汇总索引",
  },
  async () => {
    const index = tempManager.getIconsIndex();
    if (index.icons.length === 0) {
      return { content: [{ type: "text" as const, text: "当前会话尚未导出任何图标。使用 get_node 或 export_svg 工具导出图标后，索引会自动更新。" }] };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(index, null, 2) }],
    };
  }
);

server.registerTool(
  "get_page_for_codegen",
  {
    description: "一站式获取代码生成所需的完整上下文：压缩格式结构 + design tokens + 组件定义 + 颜色/字体规范",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeId: z.string().describe("目标节点/页面 ID"),
      depth: z.number().optional().default(12).describe("递归深度，默认 12"),
    },
  },
  async ({ fileKey, nodeId, depth }) => {
    const normalizedId = nodeId.replace("-", ":");

    const [nodeResult, varsResult] = await Promise.all([
      figma.getFileNodes(fileKey, [normalizedId]),
      figma.getVariables(fileKey).catch(() => null),
    ]) as [any, any];

    if (!nodeResult) return { content: [{ type: "text" as const, text: "获取节点失败" }] };
    const nodeData = nodeResult.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };

    tempManager.writeRaw(fileKey, normalizedId, nodeData);

    const node = nodeData.document;
    const variableMap = varsResult ? buildVariableMap(varsResult) : null;
    const structure = toCondensedFormat(node, 0, depth, variableMap);

    const colors = new Set<string>();
    const fonts = new Set<string>();
    const components: { name: string; componentId: string }[] = [];
    extractDesignInfo(node, colors, fonts, components);

    let tokensSummary = "";
    if (varsResult && varsResult.meta) {
      const collections = varsResult.meta.variableCollections || {};
      const variables = varsResult.meta.variables || {};
      const tokenLines: string[] = [];
      for (const [collId, coll] of Object.entries(collections) as [string, any][]) {
        const collVars = (Object.values(variables) as any[])
          .filter((v) => v.variableCollectionId === collId)
          .slice(0, 30);
        tokenLines.push(`## ${coll.name}`);
        for (const v of collVars) {
          const firstMode = Object.values(v.valuesByMode || {})[0];
          tokenLines.push(`  --${v.name}: ${formatValue(firstMode)}`);
        }
      }
      tokensSummary = tokenLines.join("\n");
    }

    const output: string[] = [
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

    const exportableNodes = svgExporter.detectExportableNodes(node);
    if (exportableNodes.length > 0) {
      try {
        const svgResults = await svgExporter.exportNodes(fileKey, exportableNodes);
        const svgSection = svgExporter.formatExportResults(svgResults);
        if (svgSection) output.push(svgSection);
        const iconEntries: any[] = [];
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
      } catch (e: any) {
        output.push(`\n## SVG Export Error\n${e.message}`);
      }
    }

    tempManager.writeOptimized(fileKey, normalizedId, {
      nodeName: node.name,
      nodeType: node.type,
      structure,
      colors: [...colors],
      fonts: [...fonts],
      components,
      tokens: tokensSummary || null,
    });

    logger.logOptimized("get_page_for_codegen", { fileKey, nodeId: normalizedId }, { nodeType: node.type, nodeName: node.name });

    return {
      content: [{ type: "text" as const, text: output.join("\n") }],
    };
  }
);

function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  try {
    const u = new URL(url);
    const pathMatch = u.pathname.match(/\/(design|file|proto)\/([a-zA-Z0-9]+)/);
    if (!pathMatch) return null;
    const fileKey = pathMatch[2];
    const nodeId = u.searchParams.get("node-id") || undefined;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}

interface ExtractedText {
  path: string;
  text: string;
  style?: string;
}

function extractAllTexts(node: any, maxDepth: number = 20, path: string = "", depth: number = 0): ExtractedText[] {
  if (!node || depth > maxDepth) return [];
  if (node.visible === false) return [];

  const results: ExtractedText[] = [];
  const currentPath = path ? `${path} > ${node.name}` : node.name;

  if (node.type === "TEXT" && node.characters) {
    const style = node.style;
    let styleStr = "";
    if (style) {
      const parts: string[] = [];
      if (style.fontFamily) parts.push(style.fontFamily);
      if (style.fontSize) parts.push(`${style.fontSize}px`);
      if (style.fontWeight && style.fontWeight !== 400) parts.push(`w${style.fontWeight}`);
      styleStr = parts.join(" ");
    }
    results.push({ path: currentPath, text: node.characters, style: styleStr || undefined });
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...extractAllTexts(child, maxDepth, currentPath, depth + 1));
    }
  }

  return results;
}

function formatVariableValues(valuesByMode: Record<string, any>, modes: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const mode of modes) {
    const value = valuesByMode[mode.modeId];
    result[mode.name] = formatValue(value);
  }
  return result;
}

function formatValue(value: any): string {
  if (!value) return "null";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  if (value.r !== undefined) {
    return colorToString(value) || "#000000";
  }
  if (value.type === "VARIABLE_ALIAS") {
    return `alias(${value.id})`;
  }
  return JSON.stringify(value);
}

function extractDesignInfo(node: any, colors: Set<string>, fonts: Set<string>, components: { name: string; componentId: string }[]): void {
  if (!node) return;

  if (node.fills) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === "SOLID" && fill.color) {
        const c = colorToString(fill.color, fill.opacity);
        if (c) colors.add(c);
      }
    }
  }

  if (node.type === "TEXT" && node.style) {
    if (node.style.fontFamily) fonts.add(node.style.fontFamily);
  }

  if (node.type === "INSTANCE" && node.componentId) {
    components.push({ name: node.name, componentId: node.componentId });
  }

  if (node.children) {
    for (const child of node.children) {
      extractDesignInfo(child, colors, fonts, components);
    }
  }
}

function nodeToCSS(node: any): string {
  const lines: string[] = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    lines.push(`width: ${bbox.width}px;`);
    lines.push(`height: ${bbox.height}px;`);
  }

  const fills = (node.fills || []).filter((f: any) => f.visible !== false);
  const fillCSS = fillsToCSS(fills);
  for (const [prop, value] of Object.entries(fillCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  const effectCSS = effectsToCSS(node.effects);
  for (const [prop, value] of Object.entries(effectCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  const strokes = (node.strokes || []).filter((s: any) => s.visible !== false);
  if (strokes.length > 0) {
    const solidStrokes = strokes.filter((s: any) => s.type === "SOLID");
    const gradientStrokes = strokes.filter((s: any) => s.type?.startsWith("GRADIENT_"));

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

  if (node.cornerRadius) {
    lines.push(`border-radius: ${node.cornerRadius}px;`);
  }

  if (node.layoutMode === "HORIZONTAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: row;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  } else if (node.layoutMode === "VERTICAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: column;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  }

  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    lines.push(`padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px;`);
  }

  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontFamily) lines.push(`font-family: "${s.fontFamily}";`);
    if (s.fontSize) lines.push(`font-size: ${s.fontSize}px;`);
    if (s.fontWeight) lines.push(`font-weight: ${s.fontWeight};`);
    if (s.lineHeightPx) lines.push(`line-height: ${s.lineHeightPx}px;`);
    if (s.letterSpacing) lines.push(`letter-spacing: ${s.letterSpacing}px;`);
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    lines.push(`opacity: ${node.opacity};`);
  }

  return `/* ${node.name} */\n.${toCSSClass(node.name)} {\n  ${lines.join("\n  ")}\n}`;
}

function toCSSClass(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "element";
}

function nodeToCSSRecursive(node: any, depth: number = 0, maxDepth: number = 8): string {
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

// PLACEHOLDER_INDEX_5

function nodeToTailwind(node: any): string {
  const classes: string[] = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    classes.push(`w-[${Math.round(bbox.width)}px]`);
    classes.push(`h-[${Math.round(bbox.height)}px]`);
  }

  const fills = (node.fills || []).filter((f: any) => f.visible !== false);
  const solidFills = fills.filter((f: any) => f.type === "SOLID");
  const gradientFills = fills.filter((f: any) => f.type?.startsWith("GRADIENT_"));

  if (gradientFills.length > 0) {
    const g = gradientToCSS(gradientFills[0]);
    if (g) classes.push(`bg-[${g.replace(/\s+/g, "_")}]`);
  } else if (solidFills.length > 0 && solidFills[0].color) {
    const c = solidFills[0].color;
    const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
    classes.push(`bg-[#${hex}]`);
  }

  const strokes = (node.strokes || []).filter((s: any) => s.visible !== false && s.type === "SOLID");
  if (strokes.length > 0 && strokes[0].color) {
    const c = strokes[0].color;
    const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
    classes.push(`border-[${node.strokeWeight || 1}px]`);
    classes.push(`border-[#${hex}]`);
  }

  if (node.layoutMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  } else if (node.layoutMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  }

  const efx = parseEffects(node.effects);
  if (efx) {
    for (const effect of efx) {
      if (effect.type === "drop-shadow") {
        classes.push(`shadow-[${effect.offset!.x}px_${effect.offset!.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "inner-shadow") {
        classes.push(`shadow-[inset_${effect.offset!.x}px_${effect.offset!.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "blur") {
        classes.push(`blur-[${effect.radius}px]`);
      } else if (effect.type === "backdrop-blur") {
        classes.push(`backdrop-blur-[${effect.radius}px]`);
      }
    }
  }

  if (node.cornerRadius) classes.push(`rounded-[${node.cornerRadius}px]`);

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

  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontSize) classes.push(`text-[${s.fontSize}px]`);
    if (s.fontWeight && s.fontWeight !== 400) classes.push(`font-[${s.fontWeight}]`);
    const textFills = (node.fills || []).filter((f: any) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0 && textFills[0].color) {
      const c = textFills[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`text-[#${hex}]`);
    }
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    classes.push(`opacity-[${Math.round(node.opacity * 100)}]`);
  }

  return classes.join(" ");
}

function nodeToTailwindRecursive(node: any, depth: number = 0, maxDepth: number = 8): string {
  if (!node || depth > maxDepth) return "";
  if (node.visible === false) return "";

  const indent = "  ".repeat(depth);
  const classes = nodeToTailwind(node);
  const semantic = inferSemanticRole(node);
  const tag = semantic?.html || "div";

  let output = `${indent}<${tag} class="${classes}"`;

  if (node.type === "TEXT") {
    output += `>${(node.characters || "").slice(0, 100)}</${tag}>\n`;
    return output;
  }

  if (!node.children || node.children.length === 0) {
    output += ` />\n`;
    return output;
  }

  output += `>\n`;
  for (const child of node.children) {
    if (child.visible === false) continue;
    output += nodeToTailwindRecursive(child, depth + 1, maxDepth);
  }
  output += `${indent}</${tag}>\n`;

  return output;
}

const transport = new StdioServerTransport();
await server.connect(transport);
