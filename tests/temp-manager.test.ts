import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TempManager } from "../src/temp-manager.js";

describe("TempManager", () => {
  let tempManager: TempManager;
  let testRoot: string;

  beforeEach(() => {
    testRoot = path.join(os.tmpdir(), `figma-test-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });
    tempManager = new TempManager(testRoot);
    tempManager.init();
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("should create directory structure on init", () => {
    expect(fs.existsSync(tempManager.logsDir)).toBe(true);
    expect(fs.existsSync(tempManager.svgDir)).toBe(true);
    expect(fs.existsSync(tempManager.rawDir)).toBe(true);
    expect(fs.existsSync(tempManager.optimizedDir)).toBe(true);
    expect(fs.existsSync(tempManager.iconsDir)).toBe(true);
  });

  it("should clean previous temp dir on init", () => {
    const testFile = path.join(tempManager.svgDir, "old.svg");
    fs.writeFileSync(testFile, "<svg></svg>");
    tempManager.init();
    expect(fs.existsSync(testFile)).toBe(false);
  });

  it("should write SVG files", () => {
    const filePath = tempManager.writeSvg("test.svg", "<svg>hello</svg>");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("<svg>hello</svg>");
  });

  it("should write raw JSON files", () => {
    const filePath = tempManager.writeRaw("fileKey1", "1:2", { test: true });
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.test).toBe(true);
  });

  it("should write optimized JSON files", () => {
    const filePath = tempManager.writeOptimized("fileKey1", "3:4", { optimized: true });
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.optimized).toBe(true);
  });

  it("should add and retrieve icons", () => {
    tempManager.addIcon({
      fileKey: "fk1",
      nodeId: "1:1",
      name: "icon-home",
      svgPath: "/tmp/icon.svg",
      source: "test",
    });

    const index = tempManager.getIconsIndex();
    expect(index.icons).toHaveLength(1);
    expect(index.icons[0].name).toBe("icon-home");
  });

  it("should update existing icon entry", () => {
    tempManager.addIcon({
      fileKey: "fk1",
      nodeId: "1:1",
      name: "icon-v1",
      svgPath: "/tmp/v1.svg",
      source: "test",
    });
    tempManager.addIcon({
      fileKey: "fk1",
      nodeId: "1:1",
      name: "icon-v2",
      svgPath: "/tmp/v2.svg",
      source: "test",
    });

    const index = tempManager.getIconsIndex();
    expect(index.icons).toHaveLength(1);
    expect(index.icons[0].name).toBe("icon-v2");
  });

  it("should batch add icons", () => {
    tempManager.addIcons([
      { fileKey: "fk1", nodeId: "1:1", name: "a", svgPath: null, source: "test" },
      { fileKey: "fk1", nodeId: "1:2", name: "b", svgPath: null, source: "test" },
    ]);

    const index = tempManager.getIconsIndex();
    expect(index.icons).toHaveLength(2);
  });

  it("should return correct directory paths", () => {
    expect(tempManager.tempDir).toContain(".figma-temp");
    expect(tempManager.logsDir).toContain("logs");
    expect(tempManager.svgDir).toContain("svg");
    expect(tempManager.rawDir).toContain("raw");
    expect(tempManager.optimizedDir).toContain("optimized");
    expect(tempManager.iconsDir).toContain("icons");
  });
});
