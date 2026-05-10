export interface DiffEntry {
  type: "changed" | "added" | "removed" | "unchanged";
  path: string;
  nodeType: string;
  nodeName: string;
  nodeId?: string;
  changes?: Array<{ prop: string; from: string; to: string }>;
  childrenCount?: number;
}

export function diffNodes(nodeA: any, nodeB: any, depth: number = 3, path: string = ""): DiffEntry[] {
  const results: DiffEntry[] = [];
  diffRecursive(nodeA, nodeB, depth, path, 0, results);
  return results;
}

function diffRecursive(a: any, b: any, maxDepth: number, path: string, depth: number, results: DiffEntry[]): void {
  if (!a || !b) return;

  const currentPath = path ? `${path} > ${a.name || b.name}` : (a.name || b.name || "");
  const changes = compareProperties(a, b);

  if (changes.length > 0) {
    results.push({
      type: "changed",
      path: currentPath,
      nodeType: a.type || b.type,
      nodeName: a.name || b.name,
      nodeId: a.id,
      changes,
    });
  }

  if (depth >= maxDepth) {
    const childCountA = a.children?.length || 0;
    const childCountB = b.children?.length || 0;
    if (childCountA > 0 || childCountB > 0) {
      results.push({
        type: "unchanged",
        path: currentPath,
        nodeType: "",
        nodeName: "",
        childrenCount: Math.max(childCountA, childCountB),
      });
    }
    return;
  }

  const childrenA: any[] = a.children || [];
  const childrenB: any[] = b.children || [];

  const mapB = new Map<string, any>();
  for (const child of childrenB) {
    if (child.id) mapB.set(child.id, child);
  }

  const matchedIds = new Set<string>();

  for (const childA of childrenA) {
    const childB = mapB.get(childA.id);
    if (childB) {
      matchedIds.add(childA.id);
      diffRecursive(childA, childB, maxDepth, currentPath, depth + 1, results);
    } else {
      results.push({
        type: "removed",
        path: currentPath,
        nodeType: childA.type,
        nodeName: childA.name,
        nodeId: childA.id,
      });
    }
  }

  for (const childB of childrenB) {
    if (!matchedIds.has(childB.id)) {
      results.push({
        type: "added",
        path: currentPath,
        nodeType: childB.type,
        nodeName: childB.name,
        nodeId: childB.id,
      });
    }
  }
}

function compareProperties(a: any, b: any): Array<{ prop: string; from: string; to: string }> {
  const changes: Array<{ prop: string; from: string; to: string }> = [];

  compareProp(changes, "name", a.name, b.name);
  compareProp(changes, "type", a.type, b.type);
  compareProp(changes, "visible", a.visible, b.visible);

  const boxA = a.absoluteBoundingBox;
  const boxB = b.absoluteBoundingBox;
  if (boxA && boxB) {
    if (boxA.width !== boxB.width || boxA.height !== boxB.height) {
      changes.push({ prop: "size", from: `${boxA.width}×${boxA.height}`, to: `${boxB.width}×${boxB.height}` });
    }
    if (boxA.x !== boxB.x || boxA.y !== boxB.y) {
      changes.push({ prop: "position", from: `(${boxA.x}, ${boxA.y})`, to: `(${boxB.x}, ${boxB.y})` });
    }
  }

  if (a.type === "TEXT" && b.type === "TEXT") {
    compareProp(changes, "content", a.characters, b.characters);
    if (a.style && b.style) {
      compareProp(changes, "fontSize", a.style.fontSize, b.style.fontSize);
      compareProp(changes, "fontFamily", a.style.fontFamily, b.style.fontFamily);
      compareProp(changes, "fontWeight", a.style.fontWeight, b.style.fontWeight);
      compareProp(changes, "lineHeight", a.style.lineHeightPx, b.style.lineHeightPx);
    }
  }

  compareProp(changes, "opacity", a.opacity, b.opacity);
  compareProp(changes, "cornerRadius", a.cornerRadius, b.cornerRadius);

  if (a.layoutMode !== undefined || b.layoutMode !== undefined) {
    compareProp(changes, "layoutMode", a.layoutMode, b.layoutMode);
    compareProp(changes, "itemSpacing", a.itemSpacing, b.itemSpacing);
    compareProp(changes, "paddingTop", a.paddingTop, b.paddingTop);
    compareProp(changes, "paddingBottom", a.paddingBottom, b.paddingBottom);
    compareProp(changes, "paddingLeft", a.paddingLeft, b.paddingLeft);
    compareProp(changes, "paddingRight", a.paddingRight, b.paddingRight);
  }

  const fillsA = JSON.stringify((a.fills || []).filter((f: any) => f.visible !== false));
  const fillsB = JSON.stringify((b.fills || []).filter((f: any) => f.visible !== false));
  if (fillsA !== fillsB) {
    changes.push({ prop: "fills", from: summarizeFills(a.fills), to: summarizeFills(b.fills) });
  }

  const strokesA = JSON.stringify(a.strokes || []);
  const strokesB = JSON.stringify(b.strokes || []);
  if (strokesA !== strokesB) {
    changes.push({ prop: "strokes", from: String(a.strokes?.length || 0), to: String(b.strokes?.length || 0) });
  }

  return changes;
}

function compareProp(changes: Array<{ prop: string; from: string; to: string }>, prop: string, a: any, b: any): void {
  if (a === b) return;
  if (a === undefined && b === undefined) return;
  changes.push({ prop, from: String(a ?? ""), to: String(b ?? "") });
}

function summarizeFills(fills: any[]): string {
  if (!fills || fills.length === 0) return "none";
  const visible = fills.filter((f) => f.visible !== false);
  if (visible.length === 0) return "none";
  return visible.map((f) => {
    if (f.type === "SOLID" && f.color) {
      const { r, g, b } = f.color;
      return `#${Math.round(r * 255).toString(16).padStart(2, "0")}${Math.round(g * 255).toString(16).padStart(2, "0")}${Math.round(b * 255).toString(16).padStart(2, "0")}`;
    }
    return f.type;
  }).join(", ");
}

export function formatDiffOutput(entries: DiffEntry[]): string {
  if (entries.length === 0) return "无差异，两个节点完全相同";

  const lines: string[] = [];
  for (const entry of entries) {
    switch (entry.type) {
      case "changed":
        lines.push(`[CHANGED] ${entry.nodeType} "${entry.nodeName}" (${entry.nodeId})`);
        for (const c of entry.changes || []) {
          lines.push(`  ~ ${c.prop}: ${c.from} → ${c.to}`);
        }
        break;
      case "added":
        lines.push(`[ADDED] ${entry.nodeType} "${entry.nodeName}" (${entry.nodeId})`);
        break;
      case "removed":
        lines.push(`[REMOVED] ${entry.nodeType} "${entry.nodeName}" (${entry.nodeId})`);
        break;
      case "unchanged":
        if (entry.childrenCount) {
          lines.push(`[UNCHANGED] ${entry.childrenCount} children`);
        }
        break;
    }
  }
  return lines.join("\n");
}
