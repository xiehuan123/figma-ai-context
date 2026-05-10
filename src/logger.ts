import { TempManager } from "./temp-manager.js";

export class Logger {
  private tempManager: TempManager;

  constructor(tempManager: TempManager) {
    this.tempManager = tempManager;
  }

  logRaw(toolName: string, requestInfo: unknown, rawData: unknown): string {
    const data = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      request: requestInfo,
      response: rawData,
    };
    return this.tempManager.writeLog(toolName, "raw", data);
  }

  logOptimized(toolName: string, requestInfo: unknown, optimizedData: unknown): string {
    const data = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      request: requestInfo,
      result: optimizedData,
    };
    return this.tempManager.writeLog(toolName, "optimized", data);
  }
}
