/**
 * SVG 导出器 - 检测、导出、下载 Figma 节点的 SVG 资源
 */

const VECTOR_TYPES = new Set([
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
  "ELLIPSE",
]);

const ICON_PATTERN = /^(icon|ico|Icons|Basics)\b/i;
const MAX_EXPORT_NODES = 20;
const MAX_INLINE_SIZE = 10 * 1024; // 10KB

export class SvgExporter {
  constructor(figmaClient, tempManager) {
    this.figma = figmaClient;
    this.tempManager = tempManager;
  }

  /**
   * 递归遍历节点树，识别需要导出为 SVG 的节点
   * @param {object} node - Figma 节点数据
   * @param {number} depth - 当前递归深度
   * @returns {Array<{id, name, role}>}
   */
  detectExportableNodes(node, depth = 0) {
    const results = [];
    if (!node) return results;

    const shouldExport = this._shouldExport(node);
    if (shouldExport) {
      results.push({
        id: node.id,
        name: node.name || "unnamed",
        role: shouldExport,
      });
    }

    // 如果当前节点本身被导出为整体，不再递归其子节点
    if (!shouldExport && node.children) {
      for (const child of node.children) {
        results.push(...this.detectExportableNodes(child, depth + 1));
      }
    }

    return results.slice(0, MAX_EXPORT_NODES);
  }

  /**
   * 判断节点是否需要导出
   * @returns {string|null} 角色名或 null
   */
  _shouldExport(node) {
    // 跳过组件实例内部的子节点（ID 含分号表示是实例内部节点）
    if (node.id && node.id.includes(";")) {
      return null;
    }

    // 名称匹配图标模式（优先级最高）
    if (ICON_PATTERN.test(node.name)) {
      return "icon";
    }

    // INSTANCE 类型且组件名匹配图标模式
    if (node.type === "INSTANCE" && ICON_PATTERN.test(node.name)) {
      return "icon";
    }

    // 顶层 VECTOR 类型节点（非嵌套在 frame 深处的装饰性向量）
    if (VECTOR_TYPES.has(node.type)) {
      return "vector";
    }

    // 包含 IMAGE fill
    if (this._hasImageFill(node)) {
      return "image";
    }

    return null;
  }

  _hasImageFill(node) {
    return (node.fills || []).some(
      (f) => f.type === "IMAGE" && f.visible !== false
    );
  }

  /**
   * 导出并下载 SVG
   * @param {string} fileKey - Figma 文件 key
   * @param {Array<{id, name, role}>} nodes - 要导出的节点列表
   * @returns {Map<string, {path, content, filename, inline}>}
   */
  async exportAndDownload(fileKey, nodes) {
    if (!nodes || nodes.length === 0) return new Map();

    const nodeIds = nodes.map((n) => n.id);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 调用 Figma API 获取 SVG 导出 URL
    let imageResponse;
    try {
      imageResponse = await this.figma.getImages(fileKey, nodeIds, "svg", 1);
    } catch (err) {
      console.error("[svg-exporter] Figma API error:", err.message);
      return new Map();
    }

    const imageUrls = imageResponse?.images || {};
    const results = new Map();

    // 并行下载所有 SVG
    const downloads = Object.entries(imageUrls).map(async ([nodeId, url]) => {
      if (!url) return;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[svg-exporter] Download failed for ${nodeId}: ${response.status}`);
          return;
        }

        const svgContent = await response.text();
        if (!svgContent || svgContent.trim().length === 0) {
          console.error(`[svg-exporter] Empty SVG content for ${nodeId}, skipping`);
          return;
        }

        const nodeInfo = nodeMap.get(nodeId);
        const filename = this._buildFilename(nodeInfo);

        // 保存到临时目录
        const filePath = this.tempManager.writeSvg(filename, svgContent);

        results.set(nodeId, {
          path: filePath,
          content: svgContent,
          filename,
          inline: svgContent.length <= MAX_INLINE_SIZE,
        });
      } catch (err) {
        console.error(`[svg-exporter] Download error for ${nodeId}:`, err.message);
      }
    });

    await Promise.all(downloads);
    return results;
  }

  /**
   * 构建 SVG 文件名
   */
  _buildFilename(nodeInfo) {
    const role = nodeInfo.role || "asset";
    const name = (nodeInfo.name || "unnamed")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const id = nodeInfo.id.replace(/[:.;]/g, "-");
    return `${role}-${name}_${id}.svg`;
  }

  /**
   * 格式化导出结果为文本（用于追加到工具响应）
   */
  formatExportResults(results) {
    if (!results || results.size === 0) return "";

    let output = "\n\n# Exported SVGs\n";
    for (const [nodeId, info] of results) {
      output += `\n## ${info.filename} (${nodeId})\n`;
      output += `Path: ${info.path}\n`;
      if (info.inline) {
        output += `\`\`\`svg\n${info.content}\n\`\`\`\n`;
      } else {
        output += `(SVG content too large to inline, see file)\n`;
      }
    }
    return output;
  }
}
