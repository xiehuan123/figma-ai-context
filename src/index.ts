#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FigmaClient, FigmaApiError } from "./figma-client.js";
import { TempManager } from "./temp-manager.js";
import { Logger } from "./logger.js";
import { SvgExporter } from "./svg-exporter.js";
import { simplifyNode, buildComponentMap, generateSummary, toCondensedFormat, inferSemanticRole, buildVariableMap, buildVariableMapFromNodes, toCondensedWithBudget, gradientToCSS, parseEffects, effectsToCSS, fillsToCSS, colorToString } from "./transformer.js";
import { parseFigmaUrl, extractAllTexts, formatVariableValues, formatValue, extractDesignInfo, toCSSClass, nodeToCSS, nodeToCSSRecursive, nodeToTailwind, nodeToTailwindRecursive, searchNodes } from "./helpers.js";
import { diffNodes, formatDiffOutput } from "./diff.js";

if (!process.env.FIGMA_TOKEN) {
  process.stderr.write(
    "Error: FIGMA_TOKEN 环境变量未设置。\n" +
    "请在 MCP 配置中添加: \"env\": { \"FIGMA_TOKEN\": \"your-token\" }\n" +
    "获取 token: https://www.figma.com/developers/api#access-tokens\n"
  );
  process.exit(1);
}

function formatError(error: unknown): { content: Array<{ type: "text"; text: string }> } {
  if (error instanceof FigmaApiError) {
    const status = error.status;
    let message: string;
    if (status === 401 || status === 403) {
      message = "Figma token 无效或无权限访问此文件，请检查 FIGMA_TOKEN 配置";
    } else if (status === 404) {
      message = "文件或节点不存在，请检查 fileKey 和 nodeId 是否正确";
    } else if (status === 429) {
      message = "Figma API 请求过于频繁，已重试多次仍失败，请稍后再试";
    } else if (status >= 500) {
      message = `Figma API 服务端错误 (${status})，请稍后重试`;
    } else {
      message = `Figma API 错误 (${status}): ${error.message}`;
    }
    return { content: [{ type: "text" as const, text: message }] };
  }

  if (error instanceof Error) {
    if (error.message.includes("fetch") || error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT")) {
      return { content: [{ type: "text" as const, text: "无法连接 Figma API，请检查网络连接" }] };
    }
    return { content: [{ type: "text" as const, text: `操作失败: ${error.message}` }] };
  }

  return { content: [{ type: "text" as const, text: "发生未知错误" }] };
}

const server = new McpServer({
  name: "figma-ai-context",
  version: "1.2.2",
});

const tempManager = new TempManager();
tempManager.init();

const logger = new Logger(tempManager);
const figma = new FigmaClient(process.env.FIGMA_TOKEN);
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
    try {
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
    } catch (error) { return formatError(error); }
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
    try {
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
      const normalizedId = resolvedNodeId.replace(/-/g, ":");
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
    } catch (error) { return formatError(error); }
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
    try {
    const normalizedId = nodeId.replace(/-/g, ":");
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
    } catch (error) { return formatError(error); }
  }
);

server.registerTool(
  "search_nodes",
  {
    description: "按名称、类型搜索文件中的节点，返回匹配节点的 ID、名称、类型和路径。适合在大文件中快速定位特定组件或元素",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      query: z.string().optional().describe("名称模糊匹配（不区分大小写）"),
      type: z.string().optional().describe("节点类型过滤，如 FRAME, COMPONENT, TEXT, INSTANCE, COMPONENT_SET 等"),
      parentId: z.string().optional().describe("限定搜索范围到某个父节点下"),
      maxResults: z.number().optional().default(20).describe("最大返回数量，默认 20"),
    },
  },
  async ({ fileKey, query, type, parentId, maxResults }) => {
    try {
    if (!query && !type) {
      return { content: [{ type: "text" as const, text: "请至少提供 query（名称搜索）或 type（类型过滤）参数" }] };
    }

    let rootNode: any;

    if (parentId) {
      const normalizedId = parentId.replace(/-/g, ":");
      const data = await figma.getFileNodes(fileKey, [normalizedId]) as any;
      if (!data) return { content: [{ type: "text" as const, text: "获取节点失败" }] };
      const nodeData = data.nodes[normalizedId];
      if (!nodeData) return { content: [{ type: "text" as const, text: `父节点 ${normalizedId} 不存在` }] };
      rootNode = nodeData.document;
    } else {
      const data = await figma.getFile(fileKey, {}) as any;
      if (!data) return { content: [{ type: "text" as const, text: "获取文件失败" }] };
      rootNode = data.document;
    }

    const results = searchNodes(rootNode, { query, type, maxResults });

    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: "未找到匹配的节点" }] };
    }

    const output = results.map((r, i) =>
      `${i + 1}. [${r.type}] ${r.name} (id: ${r.id})\n   路径: ${r.path}`
    ).join("\n\n");

    return {
      content: [{
        type: "text" as const,
        text: `# 搜索结果 (共 ${results.length} 条)\n\n${output}`,
      }],
    };
    } catch (error) { return formatError(error); }
  }
);

server.registerTool(
  "get_components",
  {
    description: "获取文件中所有组件的列表和基本信息",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
    },
  },
  async ({ fileKey }) => {
    try {
    const data = await figma.getFile(fileKey, { depth: 2 }) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取文件失败" }] };

    const componentMap = buildComponentMap(data.document);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(componentMap, null, 2) }],
    };
    } catch (error) { return formatError(error); }
  }
);

server.registerTool(
  "get_component_variants",
  {
    description: "获取 COMPONENT_SET 下所有 variant 及其属性组合，对生成组件 props 接口非常有帮助",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeId: z.string().describe("COMPONENT_SET 的节点 ID"),
    },
  },
  async ({ fileKey, nodeId }) => {
    try {
    const normalizedId = nodeId.replace(/-/g, ":");
    const data = await figma.getFileNodes(fileKey, [normalizedId]) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取节点失败" }] };

    const nodeData = data.nodes[normalizedId];
    if (!nodeData) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };

    const node = nodeData.document;
    if (node.type !== "COMPONENT_SET") {
      return { content: [{ type: "text" as const, text: `节点 ${node.name} 类型为 ${node.type}，不是 COMPONENT_SET。请传入组件集的节点 ID` }] };
    }

    const properties: Record<string, Set<string>> = {};
    const variants: Array<{ name: string; id: string; props: Record<string, string> }> = [];

    for (const child of node.children || []) {
      if (child.type !== "COMPONENT") continue;
      const props: Record<string, string> = {};
      const parts = child.name.split(",").map((s: string) => s.trim());
      for (const part of parts) {
        const [key, value] = part.split("=").map((s: string) => s.trim());
        if (key && value) {
          props[key] = value;
          if (!properties[key]) properties[key] = new Set();
          properties[key].add(value);
        }
      }
      variants.push({ name: child.name, id: child.id, props });
    }

    const output: string[] = [
      `# ${node.name}`,
      ``,
      `## 属性定义`,
    ];

    for (const [prop, values] of Object.entries(properties)) {
      output.push(`- **${prop}**: ${[...values].join(" | ")}`);
    }

    output.push(``, `## Variants (${variants.length})`);
    for (const v of variants) {
      const propsStr = Object.entries(v.props).map(([k, val]) => `${k}=${val}`).join(", ");
      output.push(`- ${propsStr} (id: ${v.id})`);
    }

    return {
      content: [{ type: "text" as const, text: output.join("\n") }],
    };
    } catch (error) { return formatError(error); }
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
    try {
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
    } catch (error) { return formatError(error); }
  }
);

server.registerTool(
  "get_styles",
  {
    description: "获取文件中所有样式定义（颜色样式、文字样式、效果样式），对理解设计系统和生成一致的代码非常有帮助",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
    },
  },
  async ({ fileKey }) => {
    try {
    const data = await figma.getFileStyles(fileKey) as any;
    if (!data || !data.meta?.styles) {
      return { content: [{ type: "text" as const, text: "未找到样式定义，该文件可能没有发布的样式" }] };
    }

    const styles = data.meta.styles as any[];
    if (styles.length === 0) {
      return { content: [{ type: "text" as const, text: "该文件没有已发布的样式" }] };
    }

    const grouped: Record<string, any[]> = { FILL: [], TEXT: [], EFFECT: [], GRID: [] };
    for (const style of styles) {
      const group = grouped[style.style_type] || [];
      group.push(style);
      grouped[style.style_type] = group;
    }

    const output: string[] = [`# 文件样式 (共 ${styles.length} 个)\n`];

    if (grouped.FILL.length > 0) {
      output.push(`## 颜色样式 (${grouped.FILL.length})`);
      for (const s of grouped.FILL) {
        output.push(`- ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      }
      output.push("");
    }

    if (grouped.TEXT.length > 0) {
      output.push(`## 文字样式 (${grouped.TEXT.length})`);
      for (const s of grouped.TEXT) {
        output.push(`- ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      }
      output.push("");
    }

    if (grouped.EFFECT.length > 0) {
      output.push(`## 效果样式 (${grouped.EFFECT.length})`);
      for (const s of grouped.EFFECT) {
        output.push(`- ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      }
      output.push("");
    }

    if (grouped.GRID.length > 0) {
      output.push(`## 网格样式 (${grouped.GRID.length})`);
      for (const s of grouped.GRID) {
        output.push(`- ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      }
      output.push("");
    }

    return {
      content: [{ type: "text" as const, text: output.join("\n") }],
    };
    } catch (error) { return formatError(error); }
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
    try {
    const normalizedId = nodeId.replace(/-/g, ":");
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
    } catch (error) { return formatError(error); }
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
    try {
    const ids = nodeIds.map((id) => id.replace(/-/g, ":"));
    const data = await figma.getImages(fileKey, ids, format, scale) as any;
    if (!data) return { content: [{ type: "text" as const, text: "获取图片失败" }] };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.images || {}, null, 2) }],
    };
    } catch (error) { return formatError(error); }
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
    try {
    const ids = nodeIds.map((id) => id.replace(/-/g, ":"));
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
    } catch (error) { return formatError(error); }
  }
);

// PLACEHOLDER_INDEX_3

const nodeSnapshots = new Map<string, any>();

server.registerTool(
  "diff_nodes",
  {
    description: "对比两个节点的差异，或对比同一节点的前后变化。支持 snapshot 模式（缓存快照后对比）和 nodes 模式（两个不同节点直接对比）",
    inputSchema: {
      fileKey: z.string().describe("Figma 文件 Key"),
      nodeId: z.string().describe("要对比的节点 ID"),
      mode: z.enum(["snapshot", "nodes"]).optional().default("nodes").describe("对比模式：snapshot（与上次快照对比）或 nodes（两节点对比，默认）"),
      targetNodeId: z.string().optional().describe("mode=nodes 时必填，对比目标节点 ID"),
      targetFileKey: z.string().optional().describe("跨文件对比时的目标文件 Key，默认与 fileKey 相同"),
      depth: z.number().optional().default(3).describe("对比递归深度，默认 3"),
    },
  },
  async ({ fileKey, nodeId, mode, targetNodeId, targetFileKey, depth }) => {
    try {
    const normalizedId = nodeId.replace(/-/g, ":");

    const dataA = await figma.getFileNodes(fileKey, [normalizedId]) as any;
    if (!dataA) return { content: [{ type: "text" as const, text: "获取节点失败" }] };
    const nodeDataA = dataA.nodes[normalizedId];
    if (!nodeDataA) return { content: [{ type: "text" as const, text: `节点 ${normalizedId} 不存在` }] };

    const nodeA = nodeDataA.document;

    if (mode === "snapshot") {
      const snapshotKey = `${fileKey}:${normalizedId}`;
      const previousSnapshot = nodeSnapshots.get(snapshotKey);
      nodeSnapshots.set(snapshotKey, JSON.parse(JSON.stringify(nodeA)));

      if (!previousSnapshot) {
        return { content: [{ type: "text" as const, text: `已保存节点 "${nodeA.name}" 的快照。再次调用此工具（相同参数）即可查看变化。` }] };
      }

      const entries = diffNodes(previousSnapshot, nodeA, depth);
      const output = formatDiffOutput(entries);
      return {
        content: [{ type: "text" as const, text: `# 节点变化: ${nodeA.name} (${normalizedId})\n\n${output}` }],
      };
    }

    if (!targetNodeId) {
      return { content: [{ type: "text" as const, text: "nodes 模式需要提供 targetNodeId 参数" }] };
    }

    const normalizedTargetId = targetNodeId.replace(/-/g, ":");
    const targetFile = targetFileKey || fileKey;
    const dataB = await figma.getFileNodes(targetFile, [normalizedTargetId]) as any;
    if (!dataB) return { content: [{ type: "text" as const, text: "获取目标节点失败" }] };
    const nodeDataB = dataB.nodes[normalizedTargetId];
    if (!nodeDataB) return { content: [{ type: "text" as const, text: `目标节点 ${normalizedTargetId} 不存在` }] };

    const nodeB = nodeDataB.document;
    const entries = diffNodes(nodeA, nodeB, depth);
    const output = formatDiffOutput(entries);

    return {
      content: [{
        type: "text" as const,
        text: `# 节点对比\n## A: ${nodeA.name} (${normalizedId})\n## B: ${nodeB.name} (${normalizedTargetId})\n\n${output}`,
      }],
    };
    } catch (error) { return formatError(error); }
  }
);

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
    try {
    const normalizedId = nodeId.replace(/-/g, ":");

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
    } catch (error) { return formatError(error); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
