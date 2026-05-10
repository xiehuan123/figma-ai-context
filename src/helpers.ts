import { colorToString, gradientToCSS, fillsToCSS, effectsToCSS, parseEffects, inferSemanticRole } from "./transformer.js";

export interface ExtractedText {
  path: string;
  text: string;
  style?: string;
}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  try {
    const u = new URL(url);
    const pathMatch = u.pathname.match(/\/(design|file|proto)\/([a-zA-Z0-9]+)/);
    if (!pathMatch) return null;
    const fileKey = pathMatch[2];
    const nodeId = u.searchParams.get("node-id") || undefined;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}

export function extractAllTexts(node: any, maxDepth: number = 20, path: string = "", depth: number = 0): ExtractedText[] {
  if (!node || depth > maxDepth) return [];
  if (node.visible === false) return [];

  const results: ExtractedText[] = [];
  const currentPath = path ? `${path} > ${node.name}` : node.name;

  if (node.type === "TEXT" && node.characters) {
    const style = node.style;
    let styleStr = "";
    if (style) {
      const parts: string[] = [];
      if (style.fontFamily) parts.push(style.fontFamily);
      if (style.fontSize) parts.push(`${style.fontSize}px`);
      if (style.fontWeight && style.fontWeight !== 400) parts.push(`w${style.fontWeight}`);
      styleStr = parts.join(" ");
    }
    results.push({ path: currentPath, text: node.characters, style: styleStr || undefined });
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...extractAllTexts(child, maxDepth, currentPath, depth + 1));
    }
  }

  return results;
}

export function formatVariableValues(valuesByMode: Record<string, any>, modes: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const mode of modes) {
    const value = valuesByMode[mode.modeId];
    result[mode.name] = formatValue(value);
  }
  return result;
}

export function formatValue(value: any): string {
  if (!value) return "null";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  if (value.r !== undefined) {
    return colorToString(value) || "#000000";
  }
  if (value.type === "VARIABLE_ALIAS") {
    return `alias(${value.id})`;
  }
  return JSON.stringify(value);
}

export function extractDesignInfo(node: any, colors: Set<string>, fonts: Set<string>, components: { name: string; componentId: string }[]): void {
  if (!node) return;

  if (node.fills) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === "SOLID" && fill.color) {
        const c = colorToString(fill.color, fill.opacity);
        if (c) colors.add(c);
      }
    }
  }

  if (node.type === "TEXT" && node.style) {
    if (node.style.fontFamily) fonts.add(node.style.fontFamily);
  }

  if (node.type === "INSTANCE" && node.componentId) {
    components.push({ name: node.name, componentId: node.componentId });
  }

  if (node.children) {
    for (const child of node.children) {
      extractDesignInfo(child, colors, fonts, components);
    }
  }
}

export function toCSSClass(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "element";
}

export function nodeToCSS(node: any): string {
  const lines: string[] = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    lines.push(`width: ${bbox.width}px;`);
    lines.push(`height: ${bbox.height}px;`);
  }

  const fills = (node.fills || []).filter((f: any) => f.visible !== false);
  const fillCSS = fillsToCSS(fills);
  for (const [prop, value] of Object.entries(fillCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  const effectCSS = effectsToCSS(node.effects);
  for (const [prop, value] of Object.entries(effectCSS)) {
    lines.push(`${prop}: ${value};`);
  }

  const strokes = (node.strokes || []).filter((s: any) => s.visible !== false);
  if (strokes.length > 0) {
    const solidStrokes = strokes.filter((s: any) => s.type === "SOLID");
    const gradientStrokes = strokes.filter((s: any) => s.type?.startsWith("GRADIENT_"));

    if (solidStrokes.length > 0 && solidStrokes[0].color) {
      const c = solidStrokes[0].color;
      const hex = `#${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      lines.push(`border: ${node.strokeWeight || 1}px solid ${hex};`);
    } else if (gradientStrokes.length > 0) {
      const gradCSS = gradientToCSS(gradientStrokes[0]);
      if (gradCSS) {
        lines.push(`border: ${node.strokeWeight || 1}px solid transparent;`);
        lines.push(`border-image: ${gradCSS} 1;`);
      }
    }
  }

  if (node.cornerRadius) {
    lines.push(`border-radius: ${node.cornerRadius}px;`);
  }

  if (node.layoutMode === "HORIZONTAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: row;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  } else if (node.layoutMode === "VERTICAL") {
    lines.push(`display: flex;`);
    lines.push(`flex-direction: column;`);
    lines.push(`gap: ${node.itemSpacing || 0}px;`);
  }

  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    lines.push(`padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px;`);
  }

  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontFamily) lines.push(`font-family: "${s.fontFamily}";`);
    if (s.fontSize) lines.push(`font-size: ${s.fontSize}px;`);
    if (s.fontWeight) lines.push(`font-weight: ${s.fontWeight};`);
    if (s.lineHeightPx) lines.push(`line-height: ${s.lineHeightPx}px;`);
    if (s.letterSpacing) lines.push(`letter-spacing: ${s.letterSpacing}px;`);
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    lines.push(`opacity: ${node.opacity};`);
  }

  return `/* ${node.name} */\n.${toCSSClass(node.name)} {\n  ${lines.join("\n  ")}\n}`;
}

export function nodeToCSSRecursive(node: any, depth: number = 0, maxDepth: number = 8): string {
  if (!node || depth > maxDepth) return "";
  if (node.visible === false) return "";

  let output = nodeToCSS(node) + "\n\n";

  if (node.children) {
    for (const child of node.children) {
      if (child.visible === false) continue;
      output += nodeToCSSRecursive(child, depth + 1, maxDepth);
    }
  }

  return output;
}

export function nodeToTailwind(node: any): string {
  const classes: string[] = [];
  const bbox = node.absoluteBoundingBox;

  if (bbox) {
    classes.push(`w-[${Math.round(bbox.width)}px]`);
    classes.push(`h-[${Math.round(bbox.height)}px]`);
  }

  const fills = (node.fills || []).filter((f: any) => f.visible !== false);
  const solidFills = fills.filter((f: any) => f.type === "SOLID");
  const gradientFills = fills.filter((f: any) => f.type?.startsWith("GRADIENT_"));

  if (gradientFills.length > 0) {
    const g = gradientToCSS(gradientFills[0]);
    if (g) classes.push(`bg-[${g.replace(/\s+/g, "_")}]`);
  } else if (solidFills.length > 0 && solidFills[0].color) {
    const c = solidFills[0].color;
    const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
    classes.push(`bg-[#${hex}]`);
  }

  const strokes = (node.strokes || []).filter((s: any) => s.visible !== false && s.type === "SOLID");
  if (strokes.length > 0 && strokes[0].color) {
    const c = strokes[0].color;
    const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
    classes.push(`border-[${node.strokeWeight || 1}px]`);
    classes.push(`border-[#${hex}]`);
  }

  if (node.layoutMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  } else if (node.layoutMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
  }

  const efx = parseEffects(node.effects);
  if (efx) {
    for (const effect of efx) {
      if (effect.type === "drop-shadow") {
        classes.push(`shadow-[${effect.offset!.x}px_${effect.offset!.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "inner-shadow") {
        classes.push(`shadow-[inset_${effect.offset!.x}px_${effect.offset!.y}px_${effect.radius}px_${effect.spread}px_${effect.color}]`);
      } else if (effect.type === "blur") {
        classes.push(`blur-[${effect.radius}px]`);
      } else if (effect.type === "backdrop-blur") {
        classes.push(`backdrop-blur-[${effect.radius}px]`);
      }
    }
  }

  if (node.cornerRadius) classes.push(`rounded-[${node.cornerRadius}px]`);

  const pt = node.paddingTop || 0;
  const pb = node.paddingBottom || 0;
  const pl = node.paddingLeft || 0;
  const pr = node.paddingRight || 0;

  if (pt === pb && pl === pr && pt === pl && pt > 0) {
    classes.push(`p-[${pt}px]`);
  } else {
    if (pt === pb && pt > 0) classes.push(`py-[${pt}px]`);
    else { if (pt > 0) classes.push(`pt-[${pt}px]`); if (pb > 0) classes.push(`pb-[${pb}px]`); }
    if (pl === pr && pl > 0) classes.push(`px-[${pl}px]`);
    else { if (pl > 0) classes.push(`pl-[${pl}px]`); if (pr > 0) classes.push(`pr-[${pr}px]`); }
  }

  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    if (s.fontSize) classes.push(`text-[${s.fontSize}px]`);
    if (s.fontWeight && s.fontWeight !== 400) classes.push(`font-[${s.fontWeight}]`);
    const textFills = (node.fills || []).filter((f: any) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0 && textFills[0].color) {
      const c = textFills[0].color;
      const hex = `${Math.round(c.r * 255).toString(16).padStart(2, "0")}${Math.round(c.g * 255).toString(16).padStart(2, "0")}${Math.round(c.b * 255).toString(16).padStart(2, "0")}`;
      classes.push(`text-[#${hex}]`);
    }
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    classes.push(`opacity-[${Math.round(node.opacity * 100)}]`);
  }

  return classes.join(" ");
}

export function nodeToTailwindRecursive(node: any, depth: number = 0, maxDepth: number = 8): string {
  if (!node || depth > maxDepth) return "";
  if (node.visible === false) return "";

  const indent = "  ".repeat(depth);
  const classes = nodeToTailwind(node);
  const semantic = inferSemanticRole(node);
  const tag = semantic?.html || "div";

  let output = `${indent}<${tag} class="${classes}"`;

  if (node.type === "TEXT") {
    output += `>${(node.characters || "").slice(0, 100)}</${tag}>\n`;
    return output;
  }

  if (!node.children || node.children.length === 0) {
    output += ` />\n`;
    return output;
  }

  output += `>\n`;
  for (const child of node.children) {
    if (child.visible === false) continue;
    output += nodeToTailwindRecursive(child, depth + 1, maxDepth);
  }
  output += `${indent}</${tag}>\n`;

  return output;
}
