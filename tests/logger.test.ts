import { describe, it, expect } from "vitest";
import { Logger } from "../src/logger.js";
import { TempManager } from "../src/temp-manager.js";

describe("Logger", () => {
  it("should call tempManager.writeLog for raw logs", () => {
    let calledWith: any = null;
    const mockTempManager = {
      writeLog: (toolName: string, type: string, data: any) => {
        calledWith = { toolName, type, data };
        return "/tmp/log.json";
      },
    } as unknown as TempManager;

    const logger = new Logger(mockTempManager);
    const result = logger.logRaw("test-tool", { path: "/test" }, { response: "data" });

    expect(result).toBe("/tmp/log.json");
    expect(calledWith.toolName).toBe("test-tool");
    expect(calledWith.type).toBe("raw");
    expect(calledWith.data.tool).toBe("test-tool");
    expect(calledWith.data.request).toEqual({ path: "/test" });
    expect(calledWith.data.response).toEqual({ response: "data" });
    expect(calledWith.data.timestamp).toBeDefined();
  });

  it("should call tempManager.writeLog for optimized logs", () => {
    let calledWith: any = null;
    const mockTempManager = {
      writeLog: (toolName: string, type: string, data: any) => {
        calledWith = { toolName, type, data };
        return "/tmp/opt.json";
      },
    } as unknown as TempManager;

    const logger = new Logger(mockTempManager);
    const result = logger.logOptimized("opt-tool", { id: "1" }, { result: "optimized" });

    expect(result).toBe("/tmp/opt.json");
    expect(calledWith.toolName).toBe("opt-tool");
    expect(calledWith.type).toBe("optimized");
    expect(calledWith.data.tool).toBe("opt-tool");
    expect(calledWith.data.result).toEqual({ result: "optimized" });
  });
});
