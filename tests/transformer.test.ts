import { describe, it, expect } from "vitest";
import {
  inferSemanticRole,
  simplifyNode,
  buildComponentMap,
  generateSummary,
  toCondensedFormat,
  toCondensedWithBudget,
  colorToString,
  gradientToCSS,
  parseEffects,
  effectsToCSS,
  fillsToCSS,
  buildVariableMap,
  buildVariableMapFromNodes,
  estimateTokens,
  FigmaNode,
} from "../src/transformer.js";

describe("inferSemanticRole", () => {
  it("should return null for null input", () => {
    expect(inferSemanticRole(null as any)).toBeNull();
  });

  it("should detect HEADER from name", () => {
    const node = { id: "1", name: "header", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "HEADER", html: "header" });
  });

  it("should detect BUTTON from name", () => {
    const node = { id: "1", name: "btn-submit", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "BUTTON", html: "button" });
  });

  it("should detect NAV from name", () => {
    const node = { id: "1", name: "navbar", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "HEADER", html: "header" });
  });

  it("should detect TEXT type", () => {
    const node = { id: "1", name: "label", type: "TEXT" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "TEXT", html: "span" });
  });

  it("should detect IMAGE from fills", () => {
    const node = { id: "1", name: "photo-bg", type: "FRAME", fills: [{ type: "IMAGE", visible: true }] } as any;
    expect(inferSemanticRole(node)).toEqual({ role: "IMG", html: "img" });
  });

  it("should detect COMPONENT type", () => {
    const node = { id: "1", name: "MyWidget", type: "COMPONENT" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "COMPONENT", html: "div" });
  });

  it("should detect CARD from name", () => {
    const node = { id: "1", name: "card-item", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "CARD", html: "article" });
  });

  it("should detect ICON from name", () => {
    const node = { id: "1", name: "icon-search", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "ICON", html: "svg" });
  });
});

// PLACEHOLDER_TEST_1

describe("colorToString", () => {
  it("should convert solid color to hex", () => {
    expect(colorToString({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("should convert color with alpha to rgba", () => {
    expect(colorToString({ r: 1, g: 0, b: 0 }, 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("should return null for undefined color", () => {
    expect(colorToString(undefined)).toBeNull();
  });

  it("should handle white color", () => {
    expect(colorToString({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
  });

  it("should handle black color", () => {
    expect(colorToString({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("should use color.a when opacity not provided", () => {
    expect(colorToString({ r: 1, g: 0, b: 0, a: 0.3 })).toBe("rgba(255, 0, 0, 0.3)");
  });
});

describe("simplifyNode", () => {
  it("should return null for null input", () => {
    expect(simplifyNode(null as any)).toBeNull();
  });

  it("should return null for hidden nodes", () => {
    const node = { id: "1", name: "hidden", type: "FRAME", visible: false } as FigmaNode;
    expect(simplifyNode(node)).toBeNull();
  });

  it("should simplify a basic frame", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Container",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
    };
    const result = simplifyNode(node);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("1:1");
    expect(result!.name).toBe("Container");
    expect(result!.bounds).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("should include fill color", () => {
    const node: FigmaNode = {
      id: "1:2",
      name: "Box",
      type: "RECTANGLE",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }],
    };
    const result = simplifyNode(node);
    expect(result!.fill).toBe("#ff0000");
  });

  it("should include text content", () => {
    const node: FigmaNode = {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      characters: "Hello World",
      style: { fontSize: 16, fontWeight: 700 },
    };
    const result = simplifyNode(node);
    expect(result!.text).toBe("Hello World");
    expect(result!.textStyle?.size).toBe(16);
    expect(result!.textStyle?.weight).toBe(700);
  });

  it("should include layout info", () => {
    const node: FigmaNode = {
      id: "1:4",
      name: "Row",
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    };
    const result = simplifyNode(node);
    expect(result!.layout).toBeDefined();
    expect(result!.layout.mode).toBe("row");
    expect(result!.layout.gap).toBe(8);
  });

  it("should recurse into children", () => {
    const node: FigmaNode = {
      id: "1:5",
      name: "Parent",
      type: "FRAME",
      children: [
        { id: "1:6", name: "Child", type: "RECTANGLE" } as FigmaNode,
      ],
    };
    const result = simplifyNode(node);
    expect(result!.children).toHaveLength(1);
    expect(result!.children![0].name).toBe("Child");
  });

  it("should respect maxDepth", () => {
    const node: FigmaNode = {
      id: "1:7",
      name: "Deep",
      type: "FRAME",
      children: [{ id: "1:8", name: "Child", type: "FRAME" } as FigmaNode],
    };
    const result = simplifyNode(node, 0, 0);
    expect(result).not.toBeNull();
    expect(result!.children).toBeUndefined();
  });

  it("should skip VECTOR types at depth > 2", () => {
    const node: FigmaNode = { id: "1:9", name: "vec", type: "VECTOR" };
    expect(simplifyNode(node, 3)).toBeNull();
    expect(simplifyNode(node, 1)).not.toBeNull();
  });
});

describe("buildComponentMap", () => {
  it("should collect components", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        { id: "2:1", name: "Button", type: "COMPONENT", description: "Primary button" } as FigmaNode,
        { id: "2:2", name: "Card", type: "COMPONENT" } as FigmaNode,
      ],
    };
    const map = buildComponentMap(node);
    expect(map["2:1"]).toEqual({ name: "Button", description: "Primary button" });
    expect(map["2:2"]).toEqual({ name: "Card", description: null });
  });

  it("should return empty map for no components", () => {
    const node: FigmaNode = { id: "1:1", name: "Page", type: "FRAME" };
    expect(buildComponentMap(node)).toEqual({});
  });
});

describe("generateSummary", () => {
  it("should return null for null input", () => {
    expect(generateSummary(null)).toBeNull();
  });

  it("should generate summary for a tree", () => {
    const simplified = simplifyNode({
      id: "1:1",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
      children: [
        { id: "1:2", name: "Title", type: "TEXT", characters: "Hello" } as FigmaNode,
      ],
    });
    const summary = generateSummary(simplified);
    expect(summary).not.toBeNull();
    expect(summary.rootName).toBe("Frame");
    expect(summary.totalNodes).toBe(2);
  });
});

describe("toCondensedFormat", () => {
  it("should return empty string for null", () => {
    expect(toCondensedFormat(null as any)).toBe("");
  });

  it("should produce condensed output", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Box",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    };
    const output = toCondensedFormat(node);
    expect(output).toContain("Box");
    expect(output).toContain("200x100");
  });

  it("should respect maxDepth", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Parent",
      type: "FRAME",
      children: [{
        id: "1:2",
        name: "Child",
        type: "FRAME",
        children: [{ id: "1:3", name: "GrandChild", type: "FRAME" } as FigmaNode],
      } as FigmaNode],
    };
    const output = toCondensedFormat(node, 0, 1);
    expect(output).toContain("Parent");
    expect(output).toContain("Child");
    expect(output).not.toContain("GrandChild");
  });
});

describe("toCondensedWithBudget", () => {
  it("should truncate deep trees when exceeding budget", () => {
    const makeDeep = (depth: number): FigmaNode => {
      if (depth === 0) return { id: "leaf", name: "Leaf", type: "TEXT", characters: "hello" } as FigmaNode;
      return {
        id: `d${depth}`,
        name: `Level${depth}`,
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
        children: [makeDeep(depth - 1), makeDeep(depth - 1), makeDeep(depth - 1)],
      } as FigmaNode;
    };
    const node = makeDeep(8);
    const full = toCondensedFormat(node, 0, 15);
    const budgeted = toCondensedWithBudget(node, 50);
    expect(budgeted.length).toBeLessThan(full.length);
  });

  it("should return full output when within budget", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Small",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
    };
    const full = toCondensedFormat(node, 0, 15);
    const budgeted = toCondensedWithBudget(node, 4000);
    expect(budgeted).toBe(full);
  });
});

describe("gradientToCSS", () => {
  it("should return null for null input", () => {
    expect(gradientToCSS(null as any)).toBeNull();
  });

  it("should convert linear gradient", () => {
    const fill = {
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
      gradientHandlePositions: [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
    };
    const result = gradientToCSS(fill as any);
    expect(result).toContain("linear-gradient");
    expect(result).toContain("#ff0000");
    expect(result).toContain("#0000ff");
  });

  it("should convert radial gradient", () => {
    const fill = {
      type: "GRADIENT_RADIAL",
      gradientStops: [
        { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 },
      ],
      gradientHandlePositions: [
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0.5 },
      ],
    };
    const result = gradientToCSS(fill as any);
    expect(result).toContain("radial-gradient");
  });
});

describe("parseEffects", () => {
  it("should return null for empty effects", () => {
    expect(parseEffects([])).toBeNull();
    expect(parseEffects(undefined)).toBeNull();
  });

  it("should parse drop shadow", () => {
    const effects = [{
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
    }];
    const result = parseEffects(effects as any);
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("drop-shadow");
    expect(result![0].offset).toEqual({ x: 0, y: 4 });
    expect(result![0].radius).toBe(8);
  });

  it("should parse blur", () => {
    const effects = [{ type: "LAYER_BLUR", visible: true, radius: 10 }];
    const result = parseEffects(effects as any);
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("blur");
    expect(result![0].radius).toBe(10);
  });

  it("should skip invisible effects", () => {
    const effects = [{ type: "DROP_SHADOW", visible: false, radius: 8 }];
    const result = parseEffects(effects as any);
    expect(result).toBeNull();
  });
});

describe("effectsToCSS", () => {
  it("should return empty for no effects", () => {
    expect(effectsToCSS(undefined)).toEqual({});
  });

  it("should generate box-shadow CSS", () => {
    const effects = [{
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 2, y: 4 },
      radius: 6,
      spread: 0,
    }];
    const css = effectsToCSS(effects as any);
    expect(css["box-shadow"]).toContain("2px 4px 6px");
  });
});

describe("fillsToCSS", () => {
  it("should return empty for no fills", () => {
    expect(fillsToCSS(undefined)).toEqual({});
  });

  it("should generate background for solid fill", () => {
    const fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }];
    const css = fillsToCSS(fills as any);
    expect(css["background"]).toBe("#ff0000");
  });
});

describe("buildVariableMap", () => {
  it("should return empty map for null input", () => {
    expect(buildVariableMap(null)).toEqual({});
  });

  it("should build variable map from API data", () => {
    const data = {
      meta: {
        variables: {
          "var1": { name: "primary", variableCollectionId: "coll1" },
          "var2": { name: "secondary", variableCollectionId: "coll1" },
        },
        variableCollections: {
          "coll1": { name: "colors" },
        },
      },
    };
    const map = buildVariableMap(data);
    expect(map["var1"]).toBe("--colors-primary");
    expect(map["var2"]).toBe("--colors-secondary");
  });
});

describe("buildVariableMapFromNodes", () => {
  it("should extract variables from fills", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Box",
      type: "FRAME",
      fills: [{
        type: "SOLID",
        color: { r: 1, g: 0, b: 0 },
        boundVariables: { color: { id: "VariableID:1:1" } },
      }],
    };
    const result = buildVariableMapFromNodes(node);
    expect(result["VariableID:1:1"]).toBeDefined();
    expect(result["VariableID:1:1"].color).toBe("#ff0000");
    expect(result["VariableID:1:1"].cssVar).toContain("--bg-");
  });
});

describe("estimateTokens", () => {
  it("should estimate tokens as length / 4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
