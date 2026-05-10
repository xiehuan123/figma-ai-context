import { describe, it, expect } from "vitest";
import {
  parseFigmaUrl,
  extractAllTexts,
  formatValue,
  formatVariableValues,
  extractDesignInfo,
  toCSSClass,
  nodeToCSS,
  nodeToCSSRecursive,
  nodeToTailwind,
  nodeToTailwindRecursive,
} from "../src/helpers.ts";

describe("parseFigmaUrl", () => {
  it("should parse design URL with node-id", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/abc123/MyFile?node-id=1-2");
    expect(result).toEqual({ fileKey: "abc123", nodeId: "1-2" });
  });

  it("should parse file URL without node-id", () => {
    const result = parseFigmaUrl("https://www.figma.com/file/xyz789/AnotherFile");
    expect(result).toEqual({ fileKey: "xyz789", nodeId: undefined });
  });

  it("should parse proto URL", () => {
    const result = parseFigmaUrl("https://www.figma.com/proto/def456/Proto?node-id=3-4");
    expect(result).toEqual({ fileKey: "def456", nodeId: "3-4" });
  });

  it("should return null for invalid URL", () => {
    expect(parseFigmaUrl("not-a-url")).toBeNull();
  });

  it("should return null for non-figma URL", () => {
    expect(parseFigmaUrl("https://example.com/something")).toBeNull();
  });
});

describe("extractAllTexts", () => {
  it("should extract text from TEXT node", () => {
    const node = { name: "Label", type: "TEXT", characters: "Hello", style: { fontFamily: "Inter", fontSize: 16 } };
    const result = extractAllTexts(node);
    expect(result).toEqual([{ path: "Label", text: "Hello", style: "Inter 16px" }]);
  });

  it("should extract texts recursively", () => {
    const node = {
      name: "Frame",
      type: "FRAME",
      children: [
        { name: "Title", type: "TEXT", characters: "Hi", style: { fontSize: 24, fontWeight: 700 } },
        { name: "Body", type: "TEXT", characters: "World", style: {} },
      ],
    };
    const result = extractAllTexts(node);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("Frame > Title");
    expect(result[0].style).toBe("24px w700");
  });
  it("should skip hidden nodes", () => {
    const node = { name: "Hidden", type: "TEXT", characters: "Secret", visible: false };
    expect(extractAllTexts(node)).toEqual([]);
  });

  it("should respect maxDepth", () => {
    const deep: any = { name: "L0", type: "FRAME", children: [{ name: "L1", type: "FRAME", children: [{ name: "L2", type: "TEXT", characters: "Deep" }] }] };
    expect(extractAllTexts(deep, 1)).toEqual([]);
  });
});

describe("formatValue", () => {
  it("should format null", () => {
    expect(formatValue(null)).toBe("null");
  });

  it("should format primitives", () => {
    expect(formatValue(42)).toBe("42");
    expect(formatValue("hello")).toBe("hello");
    expect(formatValue(true)).toBe("true");
  });

  it("should format color objects", () => {
    const result = formatValue({ r: 1, g: 0, b: 0, a: 1 });
    expect(result).toContain("ff");
  });

  it("should format variable alias", () => {
    expect(formatValue({ type: "VARIABLE_ALIAS", id: "var:123" })).toBe("alias(var:123)");
  });

  it("should JSON stringify unknown objects", () => {
    expect(formatValue({ foo: "bar" })).toBe('{"foo":"bar"}');
  });
});

describe("formatVariableValues", () => {
  it("should map mode values", () => {
    const modes = [{ modeId: "m1", name: "Light" }, { modeId: "m2", name: "Dark" }];
    const values = { m1: "#fff", m2: "#000" };
    const result = formatVariableValues(values, modes);
    expect(result).toEqual({ Light: "#fff", Dark: "#000" });
  });
});

describe("extractDesignInfo", () => {
  it("should extract colors from fills", () => {
    const colors = new Set<string>();
    const fonts = new Set<string>();
    const components: any[] = [];
    const node = { fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }] };
    extractDesignInfo(node, colors, fonts, components);
    expect(colors.size).toBe(1);
  });

  it("should extract fonts from TEXT nodes", () => {
    const colors = new Set<string>();
    const fonts = new Set<string>();
    const components: any[] = [];
    const node = { type: "TEXT", style: { fontFamily: "Inter" } };
    extractDesignInfo(node, colors, fonts, components);
    expect(fonts.has("Inter")).toBe(true);
  });

  it("should extract component instances", () => {
    const colors = new Set<string>();
    const fonts = new Set<string>();
    const components: any[] = [];
    const node = { type: "INSTANCE", name: "Button", componentId: "c:1" };
    extractDesignInfo(node, colors, fonts, components);
    expect(components).toEqual([{ name: "Button", componentId: "c:1" }]);
  });
});

describe("toCSSClass", () => {
  it("should convert name to CSS class", () => {
    expect(toCSSClass("My Button")).toBe("my-button");
  });

  it("should handle special characters", () => {
    expect(toCSSClass("Frame #1 (copy)")).toBe("frame-1-copy");
  });

  it("should return 'element' for empty result", () => {
    expect(toCSSClass("---")).toBe("element");
  });
});

describe("nodeToCSS", () => {
  it("should generate CSS with dimensions", () => {
    const node = { name: "Box", absoluteBoundingBox: { width: 100, height: 50 } };
    const css = nodeToCSS(node);
    expect(css).toContain("width: 100px");
    expect(css).toContain("height: 50px");
    expect(css).toContain(".box {");
  });

  it("should include flex layout", () => {
    const node = { name: "Row", layoutMode: "HORIZONTAL", itemSpacing: 8 };
    const css = nodeToCSS(node);
    expect(css).toContain("display: flex");
    expect(css).toContain("flex-direction: row");
    expect(css).toContain("gap: 8px");
  });

  it("should include text styles", () => {
    const node = { name: "Text", type: "TEXT", style: { fontFamily: "Inter", fontSize: 16, fontWeight: 700 } };
    const css = nodeToCSS(node);
    expect(css).toContain('font-family: "Inter"');
    expect(css).toContain("font-size: 16px");
    expect(css).toContain("font-weight: 700");
  });

  it("should include opacity", () => {
    const node = { name: "Faded", opacity: 0.5 };
    const css = nodeToCSS(node);
    expect(css).toContain("opacity: 0.5");
  });

  it("should include border-radius", () => {
    const node = { name: "Rounded", cornerRadius: 12 };
    const css = nodeToCSS(node);
    expect(css).toContain("border-radius: 12px");
  });

  it("should include padding", () => {
    const node = { name: "Padded", paddingTop: 10, paddingRight: 20, paddingBottom: 10, paddingLeft: 20 };
    const css = nodeToCSS(node);
    expect(css).toContain("padding: 10px 20px 10px 20px");
  });
});

describe("nodeToCSSRecursive", () => {
  it("should generate CSS for node and children", () => {
    const node = {
      name: "Parent",
      children: [{ name: "Child", absoluteBoundingBox: { width: 50, height: 50 } }],
    };
    const css = nodeToCSSRecursive(node);
    expect(css).toContain(".parent {");
    expect(css).toContain(".child {");
  });

  it("should skip hidden children", () => {
    const node = {
      name: "Parent",
      children: [{ name: "Hidden", visible: false }],
    };
    const css = nodeToCSSRecursive(node);
    expect(css).not.toContain(".hidden");
  });
});

describe("nodeToTailwind", () => {
  it("should generate width and height classes", () => {
    const node = { name: "Box", absoluteBoundingBox: { width: 200, height: 100 } };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("w-[200px]");
    expect(tw).toContain("h-[100px]");
  });

  it("should generate flex classes for horizontal layout", () => {
    const node = { name: "Row", layoutMode: "HORIZONTAL", itemSpacing: 12 };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("flex");
    expect(tw).toContain("flex-row");
    expect(tw).toContain("gap-[12px]");
  });

  it("should generate flex classes for vertical layout", () => {
    const node = { name: "Col", layoutMode: "VERTICAL", itemSpacing: 8 };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("flex-col");
    expect(tw).toContain("gap-[8px]");
  });

  it("should generate background color", () => {
    const node = { name: "Bg", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("bg-[#ff0000]");
  });

  it("should generate uniform padding", () => {
    const node = { name: "P", paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("p-[16px]");
  });

  it("should generate split padding", () => {
    const node = { name: "P", paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16 };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("py-[8px]");
    expect(tw).toContain("px-[16px]");
  });

  it("should generate rounded class", () => {
    const node = { name: "R", cornerRadius: 8 };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("rounded-[8px]");
  });

  it("should generate text styles for TEXT nodes", () => {
    const node = { name: "T", type: "TEXT", style: { fontSize: 14, fontWeight: 600 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };
    const tw = nodeToTailwind(node);
    expect(tw).toContain("text-[14px]");
    expect(tw).toContain("font-[600]");
    expect(tw).toContain("text-[#000000]");
  });
});

describe("nodeToTailwindRecursive", () => {
  it("should generate nested HTML structure", () => {
    const node = {
      name: "Card",
      type: "FRAME",
      children: [
        { name: "Title", type: "TEXT", characters: "Hello World" },
      ],
    };
    const html = nodeToTailwindRecursive(node);
    expect(html).toContain('class="');
    expect(html).toContain("Hello World</");
  });

  it("should self-close childless nodes", () => {
    const node = { name: "Icon", type: "FRAME" };
    const html = nodeToTailwindRecursive(node);
    expect(html).toContain("/>\n");
  });

  it("should skip hidden nodes", () => {
    const node = { name: "Hidden", type: "FRAME", visible: false };
    expect(nodeToTailwindRecursive(node)).toBe("");
  });
});
