import { describe, it, expect } from "vitest";
import { SvgExporter, FigmaNode } from "../src/svg-exporter.js";
import { FigmaClient } from "../src/figma-client.js";
import { TempManager } from "../src/temp-manager.js";

describe("SvgExporter", () => {
  const mockClient = {} as FigmaClient;
  const mockTempManager = {} as TempManager;

  describe("detectExportableNodes", () => {
    it("should return empty array for null node", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      expect(exporter.detectExportableNodes(null as any)).toEqual([]);
    });

    it("should detect vector nodes", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const node: FigmaNode = {
        id: "1:1",
        name: "arrow",
        type: "VECTOR",
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("vector");
    });

    it("should detect icon nodes by name", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const node: FigmaNode = {
        id: "1:2",
        name: "icon-search",
        type: "FRAME",
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("icon");
    });

    it("should detect export-marked nodes", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const node: FigmaNode = {
        id: "1:3",
        name: "logo",
        type: "FRAME",
        exportSettings: [{ format: "SVG" }],
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("export-marked");
    });

    it("should skip instance internal nodes (ID with semicolon)", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const node: FigmaNode = {
        id: "1:1;2:2",
        name: "icon-internal",
        type: "VECTOR",
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(0);
    });

    it("should recurse into children", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const node: FigmaNode = {
        id: "1:1",
        name: "container",
        type: "FRAME",
        children: [
          { id: "2:1", name: "icon-home", type: "FRAME" },
          { id: "2:2", name: "arrow", type: "VECTOR" },
        ],
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(2);
    });

    it("should limit results to MAX_EXPORT_NODES (20)", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const children: FigmaNode[] = Array.from({ length: 30 }, (_, i) => ({
        id: `${i}:1`,
        name: `icon-${i}`,
        type: "FRAME",
      }));
      const node: FigmaNode = {
        id: "0:1",
        name: "container",
        type: "FRAME",
        children,
      };
      const result = exporter.detectExportableNodes(node);
      expect(result).toHaveLength(20);
    });
  });

  describe("formatExportResults", () => {
    it("should return empty string for empty results", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      expect(exporter.formatExportResults(new Map())).toBe("");
    });

    it("should format inline SVG results", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const results = new Map([
        ["1:1", { path: "/tmp/icon.svg", content: "<svg></svg>", filename: "icon.svg", inline: true }],
      ]);
      const output = exporter.formatExportResults(results);
      expect(output).toContain("# Exported SVGs");
      expect(output).toContain("icon.svg");
      expect(output).toContain("<svg></svg>");
    });

    it("should note large SVGs as not inline", () => {
      const exporter = new SvgExporter(mockClient, mockTempManager);
      const results = new Map([
        ["1:1", { path: "/tmp/big.svg", content: "x".repeat(20000), filename: "big.svg", inline: false }],
      ]);
      const output = exporter.formatExportResults(results);
      expect(output).toContain("too large to inline");
    });
  });
});
