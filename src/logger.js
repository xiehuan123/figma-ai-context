/**
 * 日志系统 - 记录 Figma API 原始响应和优化后数据
 * 所有日志写入 .figma-temp/logs/ 目录
 */

export class Logger {
  constructor(tempManager) {
    this.tempManager = tempManager;
  }

  /** 记录原始 Figma API 响应 */
  logRaw(toolName, requestInfo, rawData) {
    const data = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      request: requestInfo,
      response: rawData,
    };
    return this.tempManager.writeLog(toolName, "raw", data);
  }

  /** 记录优化/转换后的数据 */
  logOptimized(toolName, requestInfo, optimizedData) {
    const data = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      request: requestInfo,
      result: optimizedData,
    };
    return this.tempManager.writeLog(toolName, "optimized", data);
  }
}
