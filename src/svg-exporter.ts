import { FigmaClient } from "./figma-client.js";
import { TempManager } from "./temp-manager.js";

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
const MAX_INLINE_SIZE = 10 * 1024;

interface ExportableNode {
  id: string;
  name: string;
  role: string;
}

interface SvgResult {
  path: string;
  content: string;
  filename: string;
  inline: boolean;
}

export interface FigmaNode {
  id: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
  exportSettings?: unknown[];
  [key: string]: unknown;
}

export class SvgExporter {
  private figma: FigmaClient;
  private tempManager: TempManager;

  constructor(figmaClient: FigmaClient, tempManager: TempManager) {
    this.figma = figmaClient;
    this.tempManager = tempManager;
  }

  detectExportableNodes(node: FigmaNode, depth: number = 0): ExportableNode[] {
    const results: ExportableNode[] = [];
    if (!node) return results;

    const shouldExport = this._shouldExport(node);
    if (shouldExport) {
      results.push({
        id: node.id,
        name: node.name || "unnamed",
        role: shouldExport,
      });
    }

    if (!shouldExport && node.children) {
      for (const child of node.children) {
        results.push(...this.detectExportableNodes(child, depth + 1));
      }
    }

    return results.slice(0, MAX_EXPORT_NODES);
  }

  private _shouldExport(node: FigmaNode): string | null {
    if (node.id && node.id.includes(";")) {
      return null;
    }

    if (node.exportSettings && Array.isArray(node.exportSettings)) {
      const hasSvgExport = node.exportSettings.some(
        (s: any) => s.format === "SVG"
      );
      if (hasSvgExport) return "export-marked";
    }

    if (node.type && VECTOR_TYPES.has(node.type)) return "vector";

    if (node.name && ICON_PATTERN.test(node.name)) return "icon";

    return null;
  }

  async exportNodes(
    fileKey: string,
    nodes: ExportableNode[]
  ): Promise<Map<string, SvgResult>> {
    const results = new Map<string, SvgResult>();
    if (nodes.length === 0) return results;

    const nodeIds = nodes.map((n) => n.id);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const imagesData = (await this.figma.getImages(fileKey, nodeIds, "svg", 1)) as {
      images?: Record<string, string>;
    };
    const images = imagesData?.images || {};

    const downloads = Object.entries(images).map(async ([nodeId, url]) => {
      if (!url) return;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const svgContent = await resp.text();

        if (!svgContent || svgContent.trim().length === 0) {
          console.error(`[svg-exporter] Empty SVG content for ${nodeId}, skipping`);
          return;
        }

        const nodeInfo = nodeMap.get(nodeId)!;
        const filename = this._buildFilename(nodeInfo);

        const filePath = this.tempManager.writeSvg(filename, svgContent);

        results.set(nodeId, {
          path: filePath,
          content: svgContent,
          filename,
          inline: svgContent.length <= MAX_INLINE_SIZE,
        });
      } catch (err: any) {
        console.error(`[svg-exporter] Download error for ${nodeId}:`, err.message);
      }
    });

    await Promise.all(downloads);
    return results;
  }

  private _buildFilename(nodeInfo: ExportableNode): string {
    const role = nodeInfo.role || "asset";
    const name = (nodeInfo.name || "unnamed")
      .replace(/[^a-zA-Z0-9一-鿿_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const id = nodeInfo.id.replace(/[:.;]/g, "-");
    return `${role}-${name}_${id}.svg`;
  }

  formatExportResults(results: Map<string, SvgResult>): string {
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
