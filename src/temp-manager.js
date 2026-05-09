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
  }

  /** 初始化：清空旧数据，创建新目录 */
  init() {
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.logsDir, { recursive: true });
    fs.mkdirSync(this.svgDir, { recursive: true });
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

  /** 写入 SVG 文件，返回完整路径 */
  writeSvg(filename, content) {
    const filePath = path.join(this.svgDir, filename);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
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
