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
  FigmaFill,
  FigmaEffect,
} from "../src/transformer.js";

describe("inferSemanticRole", () => {
  it("should return null for null input", () => {
    expect(inferSemanticRole(null as any)).toBeNull();
  });

  it("should detect HEADER from name patterns", () => {
    expect(inferSemanticRole({ id: "1", name: "header", type: "FRAME" } as FigmaNode)).toEqual({ role: "HEADER", html: "header" });
    expect(inferSemanticRole({ id: "1", name: "topnavbar", type: "FRAME" } as FigmaNode)).toEqual({ role: "HEADER", html: "header" });
    expect(inferSemanticRole({ id: "1", name: "navigation", type: "FRAME" } as FigmaNode)).toEqual({ role: "HEADER", html: "header" });
  });

  it("should detect FOOTER from name", () => {
    expect(inferSemanticRole({ id: "1", name: "footer", type: "FRAME" } as FigmaNode)).toEqual({ role: "FOOTER", html: "footer" });
    expect(inferSemanticRole({ id: "1", name: "Footer-main", type: "FRAME" } as FigmaNode)).toEqual({ role: "FOOTER", html: "footer" });
  });

  it("should detect SIDEBAR from name", () => {
    expect(inferSemanticRole({ id: "1", name: "sidebar", type: "FRAME" } as FigmaNode)).toEqual({ role: "SIDEBAR", html: "aside" });
    expect(inferSemanticRole({ id: "1", name: "side-bar", type: "FRAME" } as FigmaNode)).toEqual({ role: "SIDEBAR", html: "aside" });
    expect(inferSemanticRole({ id: "1", name: "drawer", type: "FRAME" } as FigmaNode)).toEqual({ role: "SIDEBAR", html: "aside" });
  });

  it("should detect NAV from name", () => {
    expect(inferSemanticRole({ id: "1", name: "nav-links", type: "FRAME" } as FigmaNode)).toEqual({ role: "NAV", html: "nav" });
    expect(inferSemanticRole({ id: "1", name: "menu", type: "FRAME" } as FigmaNode)).toEqual({ role: "NAV", html: "nav" });
    expect(inferSemanticRole({ id: "1", name: "tabs", type: "FRAME" } as FigmaNode)).toEqual({ role: "NAV", html: "nav" });
  });

  it("should detect BUTTON from name", () => {
    expect(inferSemanticRole({ id: "1", name: "btn-submit", type: "FRAME" } as FigmaNode)).toEqual({ role: "BUTTON", html: "button" });
    expect(inferSemanticRole({ id: "1", name: "button-primary", type: "FRAME" } as FigmaNode)).toEqual({ role: "BUTTON", html: "button" });
    expect(inferSemanticRole({ id: "1", name: "cta-signup", type: "FRAME" } as FigmaNode)).toEqual({ role: "BUTTON", html: "button" });
  });

  it("should detect INPUT from name", () => {
    expect(inferSemanticRole({ id: "1", name: "input-email", type: "FRAME" } as FigmaNode)).toEqual({ role: "INPUT", html: "input" });
    expect(inferSemanticRole({ id: "1", name: "text-field", type: "FRAME" } as FigmaNode)).toEqual({ role: "INPUT", html: "input" });
    expect(inferSemanticRole({ id: "1", name: "search-box", type: "FRAME" } as FigmaNode)).toEqual({ role: "INPUT", html: "input" });
  });

  it("should detect CARD from name", () => {
    expect(inferSemanticRole({ id: "1", name: "card-item", type: "FRAME" } as FigmaNode)).toEqual({ role: "CARD", html: "article" });
    expect(inferSemanticRole({ id: "1", name: "product-card", type: "FRAME" } as FigmaNode)).toEqual({ role: "CARD", html: "article" });
  });

  it("should detect ICON from name", () => {
    expect(inferSemanticRole({ id: "1", name: "icon-search", type: "FRAME" } as FigmaNode)).toEqual({ role: "ICON", html: "svg" });
    expect(inferSemanticRole({ id: "1", name: "ic_close", type: "FRAME" } as FigmaNode)).toEqual({ role: "ICON", html: "svg" });
  });

  it("should detect LIST from name", () => {
    expect(inferSemanticRole({ id: "1", name: "list-items", type: "FRAME" } as FigmaNode)).toEqual({ role: "LIST", html: "ul" });
  });

  it("should detect MODAL from name", () => {
    expect(inferSemanticRole({ id: "1", name: "modal-dialog", type: "FRAME" } as FigmaNode)).toEqual({ role: "MODAL", html: "dialog" });
    expect(inferSemanticRole({ id: "1", name: "popup-confirm", type: "FRAME" } as FigmaNode)).toEqual({ role: "MODAL", html: "dialog" });
  });

  it("should detect TEXT type", () => {
    expect(inferSemanticRole({ id: "1", name: "label", type: "TEXT" } as FigmaNode)).toEqual({ role: "TEXT", html: "span" });
  });

  it("should detect IMAGE from fills", () => {
    const node = { id: "1", name: "photo", type: "FRAME", fills: [{ type: "IMAGE", visible: true }] } as any;
    expect(inferSemanticRole(node)).toEqual({ role: "IMG", html: "img" });
  });

  it("should detect IMAGE type node", () => {
    const node = { id: "1", name: "photo", type: "IMAGE" } as FigmaNode;
    expect(inferSemanticRole(node)).toEqual({ role: "IMG", html: "img" });
  });

  it("should detect COMPONENT type", () => {
    expect(inferSemanticRole({ id: "1", name: "Widget", type: "COMPONENT" } as FigmaNode)).toEqual({ role: "COMPONENT", html: "div" });
    expect(inferSemanticRole({ id: "1", name: "Widget", type: "COMPONENT_SET" } as FigmaNode)).toEqual({ role: "COMPONENT", html: "div" });
  });

  it("should detect INSTANCE type", () => {
    expect(inferSemanticRole({ id: "1", name: "ButtonInstance", type: "INSTANCE" } as FigmaNode)).toEqual({ role: "INSTANCE", html: "div" });
  });

  it("should return null for generic frame with no semantic cues", () => {
    const node = { id: "1", name: "Frame 123", type: "FRAME" } as FigmaNode;
    expect(inferSemanticRole(node)).toBeNull();
  });

  it("should be case-insensitive for name matching", () => {
    expect(inferSemanticRole({ id: "1", name: "HEADER", type: "FRAME" } as FigmaNode)).toEqual({ role: "HEADER", html: "header" });
    expect(inferSemanticRole({ id: "1", name: "Footer", type: "FRAME" } as FigmaNode)).toEqual({ role: "FOOTER", html: "footer" });
  });
});

describe("colorToString", () => {
  it("should convert solid color to hex", () => {
    expect(colorToString({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("should convert color with opacity to rgba", () => {
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

  it("should treat alpha of 1 as fully opaque (hex)", () => {
    expect(colorToString({ r: 0, g: 0.5, b: 1, a: 1 })).toBe("#0080ff");
  });

  it("should handle fractional RGB values", () => {
    const result = colorToString({ r: 0.2, g: 0.4, b: 0.6 });
    expect(result).toBe("#336699");
  });

  it("should prefer explicit opacity over color.a", () => {
    expect(colorToString({ r: 1, g: 0, b: 0, a: 0.9 }, 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });
});

describe("gradientToCSS", () => {
  it("should return null for null input", () => {
    expect(gradientToCSS(null as any)).toBeNull();
  });

  it("should return null for non-gradient fill", () => {
    expect(gradientToCSS({ type: "SOLID", color: { r: 1, g: 0, b: 0 } } as any)).toBeNull();
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

  it("should handle gradient with multiple stops", () => {
    const fill = {
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 1, b: 0, a: 1 }, position: 0.5 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    };
    const result = gradientToCSS(fill as any);
    expect(result).toContain("linear-gradient");
    expect(result).toContain("#ff0000");
    expect(result).toContain("#00ff00");
    expect(result).toContain("#0000ff");
  });

  it("should handle gradient stops with alpha", () => {
    const fill = {
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 0.8 }, position: 1 },
      ],
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const result = gradientToCSS(fill as any);
    expect(result).toContain("linear-gradient");
    expect(result).toContain("rgba");
  });
});

describe("parseEffects", () => {
  it("should return empty array for undefined effects", () => {
    expect(parseEffects(undefined)).toEqual([]);
  });

  it("should return empty array for empty effects", () => {
    expect(parseEffects([])).toEqual([]);
  });

  it("should parse drop shadow", () => {
    const effects: FigmaEffect[] = [{
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
    }];
    const result = parseEffects(effects);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("DROP_SHADOW");
    expect(result[0].css).toContain("box-shadow");
  });

  it("should parse inner shadow", () => {
    const effects: FigmaEffect[] = [{
      type: "INNER_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 0,
    }];
    const result = parseEffects(effects);
    expect(result.length).toBe(1);
    expect(result[0].css).toContain("inset");
  });

  it("should parse blur effect", () => {
    const effects: FigmaEffect[] = [{
      type: "LAYER_BLUR",
      visible: true,
      radius: 10,
    }];
    const result = parseEffects(effects);
    expect(result.length).toBe(1);
    expect(result[0].css).toContain("blur");
  });

  it("should parse background blur", () => {
    const effects: FigmaEffect[] = [{
      type: "BACKGROUND_BLUR",
      visible: true,
      radius: 20,
    }];
    const result = parseEffects(effects);
    expect(result.length).toBe(1);
    expect(result[0].css).toContain("blur");
  });

  it("should skip invisible effects", () => {
    const effects: FigmaEffect[] = [{
      type: "DROP_SHADOW",
      visible: false,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
    }];
    const result = parseEffects(effects);
    expect(result).toEqual([]);
  });

  it("should parse multiple effects", () => {
    const effects: FigmaEffect[] = [
      { type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 2 }, radius: 4 },
      { type: "LAYER_BLUR", visible: true, radius: 5 },
    ];
    const result = parseEffects(effects);
    expect(result.length).toBe(2);
  });
});

describe("effectsToCSS", () => {
  it("should return empty object for undefined effects", () => {
    expect(effectsToCSS(undefined)).toEqual({});
  });

  it("should generate box-shadow CSS", () => {
    const effects: FigmaEffect[] = [{
      type: "DROP_SHADOW",
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
      spread: 0,
    }];
    const css = effectsToCSS(effects);
    expect(css["box-shadow"]).toBeDefined();
  });

  it("should generate filter for blur", () => {
    const effects: FigmaEffect[] = [{
      type: "LAYER_BLUR",
      visible: true,
      radius: 10,
    }];
    const css = effectsToCSS(effects);
    expect(css["filter"]).toContain("blur");
  });

  it("should generate backdrop-filter for background blur", () => {
    const effects: FigmaEffect[] = [{
      type: "BACKGROUND_BLUR",
      visible: true,
      radius: 20,
    }];
    const css = effectsToCSS(effects);
    expect(css["backdrop-filter"]).toContain("blur");
  });
});

describe("fillsToCSS", () => {
  it("should return empty object for undefined fills", () => {
    expect(fillsToCSS(undefined)).toEqual({});
  });

  it("should return empty object for empty array", () => {
    expect(fillsToCSS([])).toEqual({});
  });

  it("should generate background for solid fill", () => {
    const fills: FigmaFill[] = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }];
    const css = fillsToCSS(fills);
    expect(css["background"]).toBe("#ff0000");
  });

  it("should skip invisible fills", () => {
    const fills: FigmaFill[] = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: false }];
    const css = fillsToCSS(fills);
    expect(css["background"]).toBeUndefined();
  });

  it("should handle gradient fill", () => {
    const fills: FigmaFill[] = [{
      type: "GRADIENT_LINEAR",
      visible: true,
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
      ],
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    }];
    const css = fillsToCSS(fills);
    expect(css["background"]).toContain("linear-gradient");
  });

  it("should handle solid fill with opacity", () => {
    const fills: FigmaFill[] = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 0.5, visible: true }];
    const css = fillsToCSS(fills);
    expect(css["background"]).toContain("rgba");
  });
});

describe("simplifyNode", () => {
  it("should simplify a basic frame node", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Container",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
    };
    const result = simplifyNode(node);
    expect(result.id).toBe("1:1");
    expect(result.name).toBe("Container");
    expect(result.type).toBe("FRAME");
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("should skip invisible nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Hidden",
      type: "FRAME",
      visible: false,
    };
    const result = simplifyNode(node);
    expect(result).toBeNull();
  });

  it("should include semantic role when detected", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "header-main",
      type: "FRAME",
    };
    const result = simplifyNode(node);
    expect(result.semantic).toEqual({ role: "HEADER", html: "header" });
  });

  it("should include layout info for auto-layout nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
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
    expect(result.layout).toBeDefined();
    expect(result.layout.mode).toBe("HORIZONTAL");
    expect(result.layout.spacing).toBe(8);
  });

  it("should simplify children recursively", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Parent",
      type: "FRAME",
      children: [
        { id: "1:2", name: "Child1", type: "FRAME" },
        { id: "1:3", name: "Child2", type: "TEXT", characters: "Hello" },
      ],
    };
    const result = simplifyNode(node);
    expect(result.children).toHaveLength(2);
    expect(result.children[1].text).toBe("Hello");
  });

  it("should skip invisible children", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Parent",
      type: "FRAME",
      children: [
        { id: "1:2", name: "Visible", type: "FRAME" },
        { id: "1:3", name: "Hidden", type: "FRAME", visible: false },
      ],
    };
    const result = simplifyNode(node);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("Visible");
  });

  it("should include text content for TEXT nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Title",
      type: "TEXT",
      characters: "Hello World",
      style: { fontSize: 24, fontWeight: 700 },
    };
    const result = simplifyNode(node);
    expect(result.text).toBe("Hello World");
    expect(result.textStyle).toBeDefined();
    expect(result.textStyle.fontSize).toBe(24);
  });

  it("should include fills info", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Box",
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }],
    };
    const result = simplifyNode(node);
    expect(result.fills).toBeDefined();
    expect(result.fills.length).toBeGreaterThan(0);
  });

  it("should include corner radius", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Rounded",
      type: "FRAME",
      cornerRadius: 12,
    };
    const result = simplifyNode(node);
    expect(result.cornerRadius).toBe(12);
  });

  it("should include effects", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Shadow",
      type: "FRAME",
      effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8 }],
    };
    const result = simplifyNode(node);
    expect(result.effects).toBeDefined();
  });

  it("should handle component instances with componentId", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "ButtonInstance",
      type: "INSTANCE",
      componentId: "comp:1",
    };
    const result = simplifyNode(node);
    expect(result.componentId).toBe("comp:1");
  });
});

describe("buildComponentMap", () => {
  it("should return empty map for node without components", () => {
    const node: FigmaNode = { id: "1:1", name: "Frame", type: "FRAME" };
    const result = buildComponentMap(node);
    expect(result).toEqual({});
  });

  it("should map COMPONENT nodes by id", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        { id: "comp:1", name: "Button", type: "COMPONENT" },
        { id: "comp:2", name: "Card", type: "COMPONENT" },
      ],
    };
    const result = buildComponentMap(node);
    expect(result["comp:1"]).toBeDefined();
    expect(result["comp:1"].name).toBe("Button");
    expect(result["comp:2"].name).toBe("Card");
  });

  it("should find components in nested children", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        {
          id: "1:2",
          name: "Section",
          type: "FRAME",
          children: [
            { id: "comp:1", name: "DeepButton", type: "COMPONENT" },
          ],
        },
      ],
    };
    const result = buildComponentMap(node);
    expect(result["comp:1"]).toBeDefined();
    expect(result["comp:1"].name).toBe("DeepButton");
  });

  it("should include COMPONENT_SET nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        { id: "cs:1", name: "ButtonSet", type: "COMPONENT_SET", children: [
          { id: "comp:1", name: "Default", type: "COMPONENT" },
          { id: "comp:2", name: "Hover", type: "COMPONENT" },
        ]},
      ],
    };
    const result = buildComponentMap(node);
    expect(result["cs:1"]).toBeDefined();
    expect(result["comp:1"]).toBeDefined();
    expect(result["comp:2"]).toBeDefined();
  });
});

describe("generateSummary", () => {
  it("should generate summary for a simple tree", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        { id: "1:2", name: "Header", type: "FRAME" },
        { id: "1:3", name: "Title", type: "TEXT", characters: "Hello" },
      ],
    };
    const result = generateSummary(node);
    expect(result).toBeDefined();
    expect(result.totalNodes).toBeGreaterThanOrEqual(3);
  });

  it("should count node types", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: [
        { id: "1:2", name: "A", type: "FRAME" },
        { id: "1:3", name: "B", type: "TEXT", characters: "Hi" },
        { id: "1:4", name: "C", type: "TEXT", characters: "World" },
        { id: "1:5", name: "D", type: "RECTANGLE" },
      ],
    };
    const result = generateSummary(node);
    expect(result.nodeTypes["TEXT"]).toBe(2);
    expect(result.nodeTypes["FRAME"]).toBeGreaterThanOrEqual(1);
    expect(result.nodeTypes["RECTANGLE"]).toBe(1);
  });

  it("should handle single node without children", () => {
    const node: FigmaNode = { id: "1:1", name: "Alone", type: "FRAME" };
    const result = generateSummary(node);
    expect(result.totalNodes).toBe(1);
  });
});

describe("toCondensedFormat", () => {
  it("should produce condensed output for a simple node", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Container",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("Container");
    expect(result).toContain("FRAME");
    expect(result).toContain("400x300");
  });

  it("should include text content for TEXT nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Label",
      type: "TEXT",
      characters: "Hello World",
      style: { fontSize: 16 },
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("Hello World");
    expect(result).toContain("16px");
  });

  it("should truncate long text to 50 chars", () => {
    const longText = "A".repeat(100);
    const node: FigmaNode = {
      id: "1:1",
      name: "LongText",
      type: "TEXT",
      characters: longText,
    };
    const result = toCondensedFormat(node);
    expect(result).not.toContain(longText);
    expect(result).toContain("A".repeat(50));
  });

  it("should include layout info for auto-layout", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      itemSpacing: 12,
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("flex-row");
    expect(result).toContain("gap:12");
  });

  it("should include vertical layout", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Column",
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 8,
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("flex-col");
    expect(result).toContain("gap:8");
  });

  it("should include fill color", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Box",
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: true }],
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("#ff0000");
  });

  it("should include corner radius", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Rounded",
      type: "FRAME",
      cornerRadius: 8,
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("r:8");
  });

  it("should include opacity when not 1", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Faded",
      type: "FRAME",
      opacity: 0.5,
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("opacity:0.5");
  });

  it("should not include opacity when it is 1", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Full",
      type: "FRAME",
      opacity: 1,
    };
    const result = toCondensedFormat(node);
    expect(result).not.toContain("opacity");
  });

  it("should skip invisible nodes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Hidden",
      type: "FRAME",
      visible: false,
    };
    const result = toCondensedFormat(node);
    expect(result).toBe("");
  });

  it("should indent children", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Parent",
      type: "FRAME",
      children: [
        { id: "1:2", name: "Child", type: "FRAME" },
      ],
    };
    const result = toCondensedFormat(node);
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toMatch(/^\s+/);
  });

  it("should include semantic html tag when not div/span", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "header-main",
      type: "FRAME",
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("<header>");
  });

  it("should include has-image for frames with image fills", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Banner",
      type: "FRAME",
      fills: [{ type: "IMAGE", visible: true }],
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("has-image");
  });

  it("should include stroke info", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Bordered",
      type: "FRAME",
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: true }],
      strokeWeight: 1,
    };
    const result = toCondensedFormat(node);
    expect(result).toContain("border");
  });

  it("should handle variable bindings", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Themed",
      type: "FRAME",
      boundVariables: {
        fills: { id: "var:1" },
      },
    };
    const variableMap = { "var:1": "--colors-primary" };
    const result = toCondensedFormat(node, 0, variableMap);
    expect(result).toContain("var(--colors-primary)");
  });
});

describe("toCondensedWithBudget", () => {
  it("should produce output within token budget", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Page",
      type: "FRAME",
      children: Array.from({ length: 20 }, (_, i) => ({
        id: `1:${i + 2}`,
        name: `Item${i}`,
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: i * 50, width: 200, height: 40 },
      })),
    };
    const result = toCondensedWithBudget(node, 100);
    const tokens = estimateTokens(result);
    expect(tokens).toBeLessThanOrEqual(120);
  });

  it("should include all nodes when budget is large", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Small",
      type: "FRAME",
      children: [
        { id: "1:2", name: "A", type: "FRAME" },
        { id: "1:3", name: "B", type: "FRAME" },
      ],
    };
    const result = toCondensedWithBudget(node, 10000);
    expect(result).toContain("A");
    expect(result).toContain("B");
  });

  it("should handle single node", () => {
    const node: FigmaNode = { id: "1:1", name: "Solo", type: "FRAME" };
    const result = toCondensedWithBudget(node, 50);
    expect(result).toContain("Solo");
  });

  it("should truncate deep trees to fit budget", () => {
    const deepNode: FigmaNode = {
      id: "1:1",
      name: "Root",
      type: "FRAME",
      children: Array.from({ length: 50 }, (_, i) => ({
        id: `2:${i}`,
        name: `Child${i}`,
        type: "FRAME",
        children: Array.from({ length: 5 }, (_, j) => ({
          id: `3:${i * 5 + j}`,
          name: `Grandchild${j}`,
          type: "TEXT",
          characters: `Text content ${j}`,
        })),
      })),
    };
    const result = toCondensedWithBudget(deepNode, 200);
    const tokens = estimateTokens(result);
    expect(tokens).toBeLessThanOrEqual(250);
  });
});

describe("buildVariableMap", () => {
  it("should return empty map for null input", () => {
    expect(buildVariableMap(null)).toEqual({});
  });

  it("should return empty map for undefined input", () => {
    expect(buildVariableMap(undefined)).toEqual({});
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

  it("should handle multiple collections", () => {
    const data = {
      meta: {
        variables: {
          "var1": { name: "sm", variableCollectionId: "coll1" },
          "var2": { name: "primary", variableCollectionId: "coll2" },
        },
        variableCollections: {
          "coll1": { name: "spacing" },
          "coll2": { name: "colors" },
        },
      },
    };
    const map = buildVariableMap(data);
    expect(map["var1"]).toBe("--spacing-sm");
    expect(map["var2"]).toBe("--colors-primary");
  });

  it("should handle variables with slashes in name", () => {
    const data = {
      meta: {
        variables: {
          "var1": { name: "brand/primary", variableCollectionId: "coll1" },
        },
        variableCollections: {
          "coll1": { name: "colors" },
        },
      },
    };
    const map = buildVariableMap(data);
    expect(map["var1"]).toContain("--colors-");
    expect(map["var1"]).toContain("primary");
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

  it("should extract variables from strokes", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Bordered",
      type: "FRAME",
      strokes: [{
        type: "SOLID",
        color: { r: 0, g: 0, b: 1 },
        boundVariables: { color: { id: "VariableID:2:1" } },
      }],
    };
    const result = buildVariableMapFromNodes(node);
    expect(result["VariableID:2:1"]).toBeDefined();
  });

  it("should extract variables from nested children", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Parent",
      type: "FRAME",
      children: [{
        id: "1:2",
        name: "Child",
        type: "FRAME",
        fills: [{
          type: "SOLID",
          color: { r: 0, g: 1, b: 0 },
          boundVariables: { color: { id: "VariableID:3:1" } },
        }],
      }],
    };
    const result = buildVariableMapFromNodes(node);
    expect(result["VariableID:3:1"]).toBeDefined();
  });

  it("should return empty map for node without variables", () => {
    const node: FigmaNode = {
      id: "1:1",
      name: "Plain",
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    };
    const result = buildVariableMapFromNodes(node);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("estimateTokens", () => {
  it("should estimate tokens as ceil(length / 4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });

  it("should handle long strings", () => {
    const str = "x".repeat(400);
    expect(estimateTokens(str)).toBe(100);
  });

  it("should handle single character", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});
