/**
 * 临时目录管理器 - 管理 .figma-temp/ 目录的生命周期
 * 启动时清空上一次的临时数据，重新创建目录结构
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export class TempManager {
  constructor(projectRoot = PROJECT_ROOT) {
    this.tempDir = path.join(projectRoot, ".figma-temp");
    this.logsDir = path.join(this.tempDir, "logs");
    this.svgDir = path.join(this.tempDir, "svg");
    this.rawDir = path.join(this.tempDir, "raw");
    this.optimizedDir = path.join(this.tempDir, "optimized");
    this.iconsDir = path.join(this.tempDir, "icons");
    this.iconsIndexPath = path.join(this.iconsDir, "index.json");
  }

  /** 初始化：清空旧数据，创建新目录 */
  init() {
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.logsDir, { recursive: true });
    fs.mkdirSync(this.svgDir, { recursive: true });
    fs.mkdirSync(this.rawDir, { recursive: true });
    fs.mkdirSync(this.optimizedDir, { recursive: true });
    fs.mkdirSync(this.iconsDir, { recursive: true });
    // 初始化图标索引
    fs.writeFileSync(this.iconsIndexPath, JSON.stringify({ icons: [] }, null, 2), "utf-8");
  }

  getTempDir() {
    return this.tempDir;
  }

  getLogsDir() {
    return this.logsDir;
  }

  getSvgDir() {
    return this.svgDir;
  }

  getRawDir() {
    return this.rawDir;
  }

  getOptimizedDir() {
    return this.optimizedDir;
  }

  getIconsDir() {
    return this.iconsDir;
  }

  /** 写入 SVG 文件，返回完整路径 */
  writeSvg(filename, content) {
    const filePath = path.join(this.svgDir, filename);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  /** 写入原始 Figma API 数据 */
  writeRaw(fileKey, nodeId, data) {
    const safeNodeId = nodeId.replace(/:/g, "-");
    const filename = `${fileKey}_${safeNodeId}.json`;
    const filePath = path.join(this.rawDir, filename);
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  /** 写入优化后的数据 */
  writeOptimized(fileKey, nodeId, data) {
    const safeNodeId = nodeId.replace(/:/g, "-");
    const filename = `${fileKey}_${safeNodeId}.json`;
    const filePath = path.join(this.optimizedDir, filename);
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  /** 添加图标到汇总索引 */
  addIcon(entry) {
    const index = this._readIconsIndex();
    const existing = index.icons.findIndex(
      (i) => i.nodeId === entry.nodeId && i.fileKey === entry.fileKey
    );
    if (existing >= 0) {
      index.icons[existing] = { ...index.icons[existing], ...entry, updatedAt: new Date().toISOString() };
    } else {
      index.icons.push({ ...entry, createdAt: new Date().toISOString() });
    }
    fs.writeFileSync(this.iconsIndexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  /** 批量添加图标 */
  addIcons(entries) {
    const index = this._readIconsIndex();
    for (const entry of entries) {
      const existing = index.icons.findIndex(
        (i) => i.nodeId === entry.nodeId && i.fileKey === entry.fileKey
      );
      if (existing >= 0) {
        index.icons[existing] = { ...index.icons[existing], ...entry, updatedAt: new Date().toISOString() };
      } else {
        index.icons.push({ ...entry, createdAt: new Date().toISOString() });
      }
    }
    fs.writeFileSync(this.iconsIndexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  /** 获取图标索引 */
  getIconsIndex() {
    return this._readIconsIndex();
  }

  _readIconsIndex() {
    try {
      const content = fs.readFileSync(this.iconsIndexPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { icons: [] };
    }
  }

  /** 写入日志文件（非阻塞） */
  writeLog(toolName, type, data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}_${toolName}_${type}.json`;
    const filePath = path.join(this.logsDir, filename);
    const content = JSON.stringify(data, null, 2);
    fs.writeFile(filePath, content, "utf-8", () => {});
    return filePath;
  }
}
