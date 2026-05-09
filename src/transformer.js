/**
 * Figma 数据转换器 - 将原始 API 数据处理成 AI 友好的精简格式
 *
 * 核心原则：
 * 1. 去除冗余字段（如 pluginData、exportSettings 等）
 * 2. 扁平化颜色为 hex/rgba 字符串
 * 3. 保留语义化的层级结构
 * 4. 自动生成摘要信息
 * 5. 语义角色推断（header, card, button 等）
 * 6. 压缩文本格式输出（节省 60%+ token）
 */

const SKIP_TYPES = new Set(["BOOLEAN_OPERATION", "SLICE", "VECTOR", "STAR", "LINE", "REGULAR_POLYGON"]);

// --- 语义角色推断 ---

const NAME_PATTERNS = [
  { pattern: /^(top.?)?nav(bar|igation)?|header/i, role: "HEADER", html: "header" },
  { pattern: /^footer/i, role: "FOOTER", html: "footer" },
  { pattern: /^side.?bar|drawer/i, role: "SIDEBAR", html: "aside" },
  { pattern: /^nav|menu|tabs/i, role: "NAV", html: "nav" },
  { pattern: /^card|tile/i, role: "CARD", html: "article" },
  { pattern: /^(btn|button|cta)/i, role: "BUTTON", html: "button" },
  { pattern: /^(input|text.?field|search.?bar)/i, role: "INPUT", html: "input" },
  { pattern: /^(modal|dialog|popup|overlay)/i, role: "DIALOG", html: "dialog" },
  { pattern: /^(avatar|profile.?pic)/i, role: "AVATAR", html: "img" },
  { pattern: /^(badge|tag|chip|pill)/i, role: "BADGE", html: "span" },
  { pattern: /^(icon|ico)\b/i, role: "ICON", html: "svg" },
  { pattern: /^(img|image|photo|thumbnail|banner|hero.?image)/i, role: "IMG", html: "img" },
  { pattern: /^(list|items)/i, role: "LIST", html: "ul" },
  { pattern: /^(form)/i, role: "FORM", html: "form" },
  { pattern: /^(section|block|container|wrapper)/i, role: "SECTION", html: "section" },
  { pattern: /^(divider|separator|hr)/i, role: "DIVIDER", html: "hr" },
  { pattern: /^(link|anchor)/i, role: "LINK", html: "a" },
  { pattern: /^(table|grid|data.?table)/i, role: "TABLE", html: "table" },
  { pattern: /^(dropdown|select|combobox)/i, role: "SELECT", html: "select" },
  { pattern: /^(checkbox|check)/i, role: "CHECKBOX", html: "input" },
  { pattern: /^(radio)/i, role: "RADIO", html: "input" },
  { pattern: /^(toggle|switch)/i, role: "TOGGLE", html: "input" },
  { pattern: /^(tooltip|popover)/i, role: "TOOLTIP", html: "div" },
  { pattern: /^(breadcrumb)/i, role: "BREADCRUMB", html: "nav" },
  { pattern: /^(pagination|pager)/i, role: "PAGINATION", html: "nav" },
  { pattern: /^(progress|loading|spinner)/i, role: "PROGRESS", html: "div" },
  { pattern: /^(alert|notification|toast|snackbar)/i, role: "ALERT", html: "div" },
];

/**
 * 推断节点的语义角色
 * @returns {{ role: string, html: string } | null}
 */
export function inferSemanticRole(node) {
  if (!node) return null;

  // 1. 名称匹配（最高优先级）
  for (const { pattern, role, html } of NAME_PATTERNS) {
    if (pattern.test(node.name)) {
      return { role, html };
    }
  }

  // 2. 类型直接映射
  if (node.type === "TEXT") return { role: "TEXT", html: "span" };
  if (node.type === "IMAGE" || hasImageFill(node)) return { role: "IMG", html: "img" };

  // 3. 结构推断（需要 children 信息）
  if (node.children && node.children.length > 0) {
    const structural = inferFromStructure(node);
    if (structural) return structural;
  }

  // 4. 对 INSTANCE 使用组件名
  if (node.type === "INSTANCE" && node.name) {
    // 尝试用组件名再匹配一次
    for (const { pattern, role, html } of NAME_PATTERNS) {
      if (pattern.test(node.name)) {
        return { role, html };
      }
    }
    return { role: node.name.toUpperCase().replace(/[^A-Z0-9]/g, "_"), html: "div" };
  }

  // 5. COMPONENT / COMPONENT_SET
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    return { role: "COMPONENT", html: "div" };
  }

  return null;
}

function hasImageFill(node) {
  return (node.fills || []).some((f) => f.type === "IMAGE" && f.visible !== false);
}

function inferFromStructure(node) {
  const children = node.children || [];
  if (children.length === 0) return null;

  const bbox = node.absoluteBoundingBox;
  const hasText = children.some((c) => c.type === "TEXT");
  const hasImage = children.some((c) => c.type === "IMAGE" || hasImageFill(c));
  const isHorizontal = node.layoutMode === "HORIZONTAL";
  const isVertical = node.layoutMode === "VERTICAL";

  // 小尺寸 + 圆角 + 背景色 + 文本居中 → button
  if (bbox && bbox.width < 300 && bbox.height < 64 && node.cornerRadius && hasText) {
    const fills = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (fills.length > 0) {
      return { role: "BUTTON", html: "button" };
    }
  }

  // 图片 + 文本组合 → card
  if (hasImage && hasText && (isHorizontal || isVertical)) {
    return { role: "CARD", html: "article" };
  }

  // 全宽 + 顶部位置 + 水平布局 → header
  if (bbox && bbox.width > 900 && bbox.y < 100 && isHorizontal) {
    return { role: "HEADER", html: "header" };
  }

  // 全宽 + 底部位置 → footer
  if (bbox && bbox.width > 900 && bbox.y > 700 && isHorizontal) {
    return { role: "FOOTER", html: "footer" };
  }

  return null;
}

/**
 * 递归简化 Figma 节点树
 */
export function simplifyNode(node, depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return null;
  if (!node) return null;
  if (SKIP_TYPES.has(node.type) && depth > 2) return null;
  if (node.visible === false) return null;

  const result = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // 语义角色推断
  const semantic = inferSemanticRole(node);
  if (semantic) {
    result.role = semantic.role;
    result.htmlTag = semantic.html;
  }

  // 尺寸
  const bbox = node.absoluteBoundingBox;
  if (bbox) {
    result.bounds = {
      x: Math.round(bbox.x),
      y: Math.round(bbox.y),
      w: Math.round(bbox.width),
      h: Math.round(bbox.height),
    };
  }

  // 填充 → 支持纯色和渐变
  const allFills = (node.fills || []).filter((f) => f.visible !== false);
  const solidFills = allFills.filter((f) => f.type === "SOLID");
  const gradientFills = allFills.filter((f) => f.type?.startsWith("GRADIENT_"));

  if (solidFills.length > 0) {
    result.fill = colorToString(solidFills[0].color, solidFills[0].opacity);
  }
  if (gradientFills.length > 0) {
    result.gradient = gradientFills.map((f) => ({
      type: f.type,
      stops: (f.gradientStops || []).map((s) => ({
        color: colorToString(s.color, s.color?.a),
        position: Math.round(s.position * 100) / 100,
      })),
      css: gradientToCSS(f),
    }));
  }

  // Effects（阴影、模糊）
  const effects = parseEffects(node.effects);
  if (effects) {
    result.effects = effects;
  }

  // 描边（支持纯色和渐变）
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokes.length > 0) {
    const solidStrokes = strokes.filter((s) => s.type === "SOLID");
    const gradientStrokes = strokes.filter((s) => s.type?.startsWith("GRADIENT_"));

    if (solidStrokes.length > 0 && solidStrokes[0].color) {
      result.stroke = {
        color: colorToString(solidStrokes[0].color),
        weight: node.strokeWeight || 1,
      };
    } else if (gradientStrokes.length > 0) {
      result.stroke = {
        gradient: gradientStrokes.map((s) => ({
          type: s.type,
          css: gradientToCSS(s),
        })),
        weight: node.strokeWeight || 1,
      };
    }
  }

  // 圆角
  if (node.cornerRadius) {
    result.cornerRadius = node.cornerRadius;
  } else if (node.rectangleCornerRadii) {
    const r = node.rectangleCornerRadii;
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3]) {
      result.cornerRadius = r[0];
    } else {
      result.cornerRadius = r;
    }
  }

  // Auto Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    result.layout = {
      direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
      gap: node.itemSpacing || 0,
      padding: compactPadding(node),
      align: mapAlign(node.primaryAxisAlignItems),
      crossAlign: mapAlign(node.counterAxisAlignItems),
    };
    if (node.layoutWrap === "WRAP") result.layout.wrap = true;
    if (node.primaryAxisSizingMode === "AUTO") result.layout.mainAxisAuto = true;
    if (node.counterAxisSizingMode === "AUTO") result.layout.crossAxisAuto = true;
  }

  // 文本内容
  if (node.type === "TEXT") {
    result.text = node.characters || "";
    const style = node.style || {};
    result.textStyle = {};
    if (style.fontFamily) result.textStyle.font = style.fontFamily;
    if (style.fontSize) result.textStyle.size = style.fontSize;
    if (style.fontWeight) result.textStyle.weight = style.fontWeight;
    if (style.lineHeightPx) result.textStyle.lineHeight = Math.round(style.lineHeightPx * 10) / 10;
    if (style.letterSpacing) result.textStyle.letterSpacing = style.letterSpacing;
    if (style.textAlignHorizontal) result.textStyle.align = style.textAlignHorizontal.toLowerCase();

    // 文本颜色
    const textFills = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0) {
      result.textStyle.color = colorToString(textFills[0].color, textFills[0].opacity);
    }

    if (Object.keys(result.textStyle).length === 0) delete result.textStyle;
  }

  // 组件信息
  if (node.type === "INSTANCE" && node.componentId) {
    result.componentId = node.componentId;
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    result.isComponent = true;
    if (node.description) result.description = node.description;
  }

  // Design Token 绑定（boundVariables）
  if (node.boundVariables) {
    const tokens = {};
    for (const [prop, binding] of Object.entries(node.boundVariables)) {
      if (binding && binding.id) {
        tokens[prop] = binding.id;
      } else if (Array.isArray(binding)) {
        // 多值绑定（如 fills 数组）
        tokens[prop] = binding.map((b) => b.id).filter(Boolean);
      }
    }
    if (Object.keys(tokens).length > 0) {
      result.tokens = tokens;
    }
  }

  // 透明度
  if (node.opacity !== undefined && node.opacity !== 1) {
    result.opacity = Math.round(node.opacity * 100) / 100;
  }

  // 约束（响应式布局）+ 响应式提示
  if (node.constraints) {
    const { horizontal, vertical } = node.constraints;
    if (horizontal !== "LEFT" || vertical !== "TOP") {
      result.constraints = { h: horizontal, v: vertical };
    }
    // 生成响应式布局建议
    const hint = inferResponsiveHint(node);
    if (hint) result.responsiveHint = hint;
  }

  // 子节点
  if (node.children && node.children.length > 0) {
    const children = node.children
      .map((child) => simplifyNode(child, depth + 1, maxDepth))
      .filter(Boolean);
    if (children.length > 0) {
      result.children = children;
    }
  }

  return result;
}

/**
 * 构建组件映射表
 */
export function buildComponentMap(node, map = {}) {
  if (node.type === "COMPONENT") {
    map[node.id] = {
      name: node.name,
      description: node.description || null,
    };
  }
  if (node.children) {
    for (const child of node.children) {
      buildComponentMap(child, map);
    }
  }
  return map;
}

/**
 * 生成节点树摘要
 */
export function generateSummary(tree) {
  if (!tree) return null;

  const stats = { total: 0, types: {}, texts: [], components: [] };
  walkTree(tree, stats);

  return {
    rootName: tree.name,
    rootType: tree.type,
    rootSize: tree.bounds ? `${tree.bounds.w}x${tree.bounds.h}` : null,
    totalNodes: stats.total,
    nodeTypes: stats.types,
    textContents: stats.texts.slice(0, 20),
    componentInstances: stats.components.slice(0, 20),
  };
}

/**
 * 带 token 预算管理的压缩格式输出
 * 当输出超过预算时，智能截断深层节点
 *
 * @param {object} node - Figma 节点
 * @param {number} maxTokens - 最大 token 数（约 4 字符 = 1 token）
 * @param {object} variableMap - 可选 variable 映射
 * @returns {string} 压缩格式文本
 */
export function toCondensedWithBudget(node, maxTokens = 4000, variableMap = null) {
  const maxChars = maxTokens * 4;

  // 先尝试完整输出
  const full = toCondensedFormat(node, 0, 15, variableMap);
  if (full.length <= maxChars) return full;

  // 超预算：逐步降低深度直到符合
  for (let depth = 10; depth >= 2; depth--) {
    const result = toCondensedFormat(node, 0, depth, variableMap);
    if (result.length <= maxChars) {
      return result + `\n  ... (已截断，深度限制: ${depth}，完整节点树更深)`;
    }
  }

  // 极端情况：只输出顶层 + 直接子节点摘要
  return toCondensedFormat(node, 0, 2, variableMap) + `\n  ... (节点树过大，仅展示前 2 层)`;
}

/**
 * 估算文本的 token 数
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// --- Internal helpers ---

function inferResponsiveHint(node) {
  const bbox = node.absoluteBoundingBox;
  const constraints = node.constraints;
  if (!bbox || !constraints) return null;

  const hints = [];

  // 水平约束分析
  if (constraints.horizontal === "LEFT_RIGHT") {
    hints.push("stretch-x");
  } else if (constraints.horizontal === "SCALE") {
    hints.push("fluid-width");
  } else if (constraints.horizontal === "CENTER") {
    hints.push("center-x");
  }

  // 垂直约束分析
  if (constraints.vertical === "TOP_BOTTOM") {
    hints.push("stretch-y");
  } else if (constraints.vertical === "SCALE") {
    hints.push("fluid-height");
  } else if (constraints.vertical === "CENTER") {
    hints.push("center-y");
  }

  // 宽度分析
  if (bbox.width > 1200) {
    hints.push("full-width, use max-width");
  } else if (bbox.width > 768 && constraints.horizontal === "LEFT") {
    hints.push("fixed-desktop, needs mobile adaptation");
  }

  return hints.length > 0 ? hints.join(", ") : null;
}

function walkTree(node, stats) {
  stats.total++;
  stats.types[node.type] = (stats.types[node.type] || 0) + 1;

  if (node.type === "TEXT" && node.text) {
    stats.texts.push({ name: node.name, text: node.text.slice(0, 100) });
  }
  if (node.type === "INSTANCE") {
    stats.components.push({ name: node.name, componentId: node.componentId });
  }

  if (node.children) {
    for (const child of node.children) {
      walkTree(child, stats);
    }
  }
}

function colorToString(color, opacity) {
  if (!color) return null;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = opacity !== undefined ? opacity : color.a !== undefined ? color.a : 1;

  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * 将渐变填充转为 CSS gradient 字符串
 *
 * Figma gradientHandlePositions:
 * - [0] = 中心点 (归一化 0~1 坐标)
 * - [1] = 第一半径终点 (决定垂直方向大小)
 * - [2] = 第二半径终点 (决定水平方向大小)
 */
export function gradientToCSS(fill) {
  if (!fill || !fill.gradientStops) return null;

  // fill-level opacity 需要乘到每个 stop 的 alpha 上
  const fillOpacity = fill.opacity !== undefined ? fill.opacity : 1;

  const stops = fill.gradientStops.map((stop) => {
    const stopAlpha = (stop.color?.a !== undefined ? stop.color.a : 1) * fillOpacity;
    const color = colorToString(stop.color, stopAlpha);
    const position = Math.round(stop.position * 1000) / 10;
    return `${color} ${position}%`;
  }).join(", ");

  if (fill.type === "GRADIENT_LINEAR") {
    const angle = calcGradientAngle(fill.gradientHandlePositions);
    return `linear-gradient(${angle}deg, ${stops})`;
  } else if (fill.type === "GRADIENT_RADIAL") {
    const { rx, ry, cx, cy } = calcRadialGradientParams(fill.gradientHandlePositions);
    const sizeStr = `${rx}% ${ry}%`;
    const posStr = `${cx}% ${cy}%`;
    return `radial-gradient(${sizeStr} at ${posStr}, ${stops})`;
  } else if (fill.type === "GRADIENT_ANGULAR") {
    return `conic-gradient(${stops})`;
  } else if (fill.type === "GRADIENT_DIAMOND") {
    // CSS 没有 diamond gradient，用 radial 近似
    const { rx, ry, cx, cy } = calcRadialGradientParams(fill.gradientHandlePositions);
    return `radial-gradient(${rx}% ${ry}% at ${cx}% ${cy}%, ${stops})`;
  }
  return null;
}

/**
 * 从 Figma gradientHandlePositions 计算径向渐变参数
 * positions[0] = center, positions[1] = ry endpoint, positions[2] = rx endpoint
 * 返回百分比值
 */
function calcRadialGradientParams(positions) {
  if (!positions || positions.length < 3) {
    return { rx: 50, ry: 50, cx: 50, cy: 50 };
  }
  const center = positions[0];
  const p1 = positions[1]; // 垂直半径终点
  const p2 = positions[2]; // 水平半径终点

  // 计算椭圆半径（归一化坐标 → 百分比）
  const ry = Math.sqrt((p1.x - center.x) ** 2 + (p1.y - center.y) ** 2) * 100;
  const rx = Math.sqrt((p2.x - center.x) ** 2 + (p2.y - center.y) ** 2) * 100;

  // 中心点百分比
  const cx = Math.round(center.x * 100 * 100) / 100;
  const cy = Math.round(center.y * 100 * 100) / 100;

  return {
    rx: Math.round(rx * 100) / 100,
    ry: Math.round(ry * 100) / 100,
    cx,
    cy,
  };
}

/**
 * 从 Figma gradientHandlePositions 计算线性渐变角度
 * positions[0] = start, positions[1] = end
 */
function calcGradientAngle(positions) {
  if (!positions || positions.length < 2) return 180;
  const start = positions[0];
  const end = positions[1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // CSS 角度：0deg = to top, 90deg = to right
  const angle = Math.round(Math.atan2(dx, -dy) * (180 / Math.PI));
  return ((angle % 360) + 360) % 360;
}

/**
 * 将 Figma effects 数组转为结构化数据
 */
export function parseEffects(effects) {
  if (!effects || effects.length === 0) return null;

  const result = [];
  for (const effect of effects) {
    if (effect.visible === false) continue;

    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      result.push({
        type: effect.type === "DROP_SHADOW" ? "drop-shadow" : "inner-shadow",
        color: colorToString(effect.color, effect.color?.a),
        offset: { x: effect.offset?.x || 0, y: effect.offset?.y || 0 },
        radius: effect.radius || 0,
        spread: effect.spread || 0,
      });
    } else if (effect.type === "LAYER_BLUR") {
      result.push({
        type: "blur",
        radius: effect.radius || 0,
      });
    } else if (effect.type === "BACKGROUND_BLUR") {
      result.push({
        type: "backdrop-blur",
        radius: effect.radius || 0,
      });
    }
  }

  return result.length > 0 ? result : null;
}

/**
 * 将 effects 转为 CSS 属性字符串
 */
export function effectsToCSS(effects) {
  if (!effects || effects.length === 0) return {};

  const parsed = parseEffects(effects);
  if (!parsed) return {};

  const css = {};
  const shadows = [];
  const filters = [];
  const backdropFilters = [];

  for (const effect of parsed) {
    if (effect.type === "drop-shadow") {
      shadows.push(`${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread}px ${effect.color}`);
    } else if (effect.type === "inner-shadow") {
      shadows.push(`inset ${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread}px ${effect.color}`);
    } else if (effect.type === "blur") {
      filters.push(`blur(${effect.radius}px)`);
    } else if (effect.type === "backdrop-blur") {
      backdropFilters.push(`blur(${effect.radius}px)`);
    }
  }

  if (shadows.length > 0) css["box-shadow"] = shadows.join(", ");
  if (filters.length > 0) css["filter"] = filters.join(" ");
  if (backdropFilters.length > 0) css["backdrop-filter"] = backdropFilters.join(" ");

  return css;
}

/**
 * 将所有可见 fills 转为 CSS background 属性
 * 支持 SOLID、渐变、IMAGE 混合叠加
 * Figma fills 数组顺序：最后一个在最上层（类似 CSS 多背景从前到后）
 */
export function fillsToCSS(fills) {
  if (!fills || fills.length === 0) return {};

  const visibleFills = fills.filter((f) => f.visible !== false);
  if (visibleFills.length === 0) return {};

  // 单个纯色
  if (visibleFills.length === 1 && visibleFills[0].type === "SOLID") {
    const color = colorToString(visibleFills[0].color, visibleFills[0].opacity);
    return { "background-color": color };
  }

  // 单个渐变
  if (visibleFills.length === 1 && visibleFills[0].type?.startsWith("GRADIENT_")) {
    const gradient = gradientToCSS(visibleFills[0]);
    if (gradient) return { "background": gradient };
  }

  // 多层填充：Figma 支持多层叠加
  // CSS 多背景语法：渐变可以叠加，纯色需要转为 linear-gradient(color, color)
  const css = {};
  const backgrounds = [];

  for (const fill of visibleFills.reverse()) {
    // 反转：Figma 最后一个在上面，CSS 第一个在上面
    if (fill.type === "SOLID") {
      const color = colorToString(fill.color, fill.opacity);
      // 纯色转为渐变形式以便和其他渐变叠加
      backgrounds.push(`linear-gradient(${color}, ${color})`);
    } else if (fill.type?.startsWith("GRADIENT_")) {
      const g = gradientToCSS(fill);
      if (g) {
        // 如果有 opacity，包裹一层
        if (fill.opacity !== undefined && fill.opacity < 1) {
          backgrounds.push(g);
        } else {
          backgrounds.push(g);
        }
      }
    }
    // IMAGE 类型无法直接转 CSS，跳过
  }

  if (backgrounds.length === 1) {
    css["background"] = backgrounds[0];
  } else if (backgrounds.length > 1) {
    css["background"] = backgrounds.join(", ");
  }

  return css;
}

function compactPadding(node) {
  const t = node.paddingTop || 0;
  const r = node.paddingRight || 0;
  const b = node.paddingBottom || 0;
  const l = node.paddingLeft || 0;

  if (t === r && r === b && b === l) return t;
  if (t === b && l === r) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function mapAlign(value) {
  const map = {
    MIN: "start",
    CENTER: "center",
    MAX: "end",
    SPACE_BETWEEN: "space-between",
  };
  return map[value] || value;
}

/**
 * 从 Figma Variables API 响应构建 ID → 名称映射表
 * @param {object} variablesData - getVariables() 返回的数据
 * @returns {object} variableId → variableName 映射
 */
export function buildVariableMap(variablesData) {
  const map = {};
  if (!variablesData || !variablesData.meta || !variablesData.meta.variables) {
    return map;
  }
  for (const [id, variable] of Object.entries(variablesData.meta.variables)) {
    // 使用 collection/name 格式，方便生成 CSS 变量名
    const collection = variablesData.meta.variableCollections?.[variable.variableCollectionId];
    const prefix = collection ? collection.name : "";
    map[id] = prefix ? `--${prefix}-${variable.name}` : `--${variable.name}`;
  }
  return map;
}

/**
 * 从节点树中提取 boundVariables，构建 variableId → { color, name } 映射
 * 当 Variables API 不可用时（token 权限不足），用此方法从节点数据中推断变量信息
 *
 * @param {object} node - Figma 原始节点
 * @returns {object} variableId → { color, cssVar, usageContext }
 */
export function buildVariableMapFromNodes(node) {
  const varEntries = {};

  function collect(n, parentContext = "") {
    if (!n) return;

    // 从 fills 中收集
    if (n.fills) {
      for (const fill of n.fills) {
        if (fill.type === "SOLID" && fill.boundVariables?.color?.id) {
          const id = fill.boundVariables.color.id;
          const c = fill.color;
          const hex = colorToHex(c);
          if (!varEntries[id]) {
            varEntries[id] = { color: hex, contexts: [] };
          }
          varEntries[id].contexts.push({ node: n.name, type: n.type, usage: "fill" });
        }
        // 渐变 stops 中的变量
        if (fill.gradientStops) {
          for (const stop of fill.gradientStops) {
            if (stop.boundVariables?.color?.id) {
              const id = stop.boundVariables.color.id;
              const c = stop.color;
              const hex = colorToHex(c);
              if (!varEntries[id]) {
                varEntries[id] = { color: hex, contexts: [] };
              }
              varEntries[id].contexts.push({ node: n.name, type: n.type, usage: "gradient-stop" });
            }
          }
        }
      }
    }

    // 从 strokes 中收集
    if (n.strokes) {
      for (const stroke of n.strokes) {
        if (stroke.type === "SOLID" && stroke.boundVariables?.color?.id) {
          const id = stroke.boundVariables.color.id;
          const c = stroke.color;
          const hex = colorToHex(c);
          if (!varEntries[id]) {
            varEntries[id] = { color: hex, contexts: [] };
          }
          varEntries[id].contexts.push({ node: n.name, type: n.type, usage: "stroke" });
        }
        if (stroke.gradientStops) {
          for (const stop of stroke.gradientStops) {
            if (stop.boundVariables?.color?.id) {
              const id = stop.boundVariables.color.id;
              const c = stop.color;
              const hex = colorToHex(c);
              if (!varEntries[id]) {
                varEntries[id] = { color: hex, contexts: [] };
              }
              varEntries[id].contexts.push({ node: n.name, type: n.type, usage: "stroke-gradient" });
            }
          }
        }
      }
    }

    // 从 effects 中收集
    if (n.effects) {
      for (const effect of n.effects) {
        if (effect.boundVariables?.color?.id) {
          const id = effect.boundVariables.color.id;
          const c = effect.color;
          const hex = colorToHex(c);
          if (!varEntries[id]) {
            varEntries[id] = { color: hex, contexts: [] };
          }
          varEntries[id].contexts.push({ node: n.name, type: n.type, usage: "effect" });
        }
      }
    }

    if (n.children) {
      for (const child of n.children) {
        collect(child);
      }
    }
  }

  collect(node);

  // 为每个变量生成 CSS 变量名
  const result = {};
  for (const [id, entry] of Object.entries(varEntries)) {
    const cssVar = inferCSSVarName(id, entry);
    result[id] = {
      color: entry.color,
      cssVar,
    };
  }

  return result;
}

/**
 * 根据变量的使用上下文推断 CSS 变量名
 */
function inferCSSVarName(id, entry) {
  const { color, contexts } = entry;

  // 从 ID 中提取数字部分作为唯一标识
  const idNum = id.replace("VariableID:", "").replace(/:/g, "-");

  // 根据使用场景推断前缀
  const usages = contexts.map((c) => c.usage);
  const nodeTypes = contexts.map((c) => c.type);

  let prefix = "color";

  if (usages.includes("fill")) {
    if (nodeTypes.includes("TEXT")) {
      prefix = "text";
    } else {
      prefix = "bg";
    }
  } else if (usages.includes("stroke") || usages.includes("stroke-gradient")) {
    prefix = "border";
  } else if (usages.includes("gradient-stop")) {
    prefix = "gradient";
  } else if (usages.includes("effect")) {
    prefix = "effect";
  }

  return `--${prefix}-${idNum}`;
}

function colorToHex(c) {
  if (!c) return "#000000";
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// --- 压缩文本格式（Condensed Format） ---

/**
 * 将 Figma 节点树转为压缩文本格式
 * 格式：[TYPE "name" WxH styles... "textContent"?]
 * 用缩进表示层级，一行一个节点，节省 60%+ token
 *
 * @param {object} node - Figma 节点
 * @param {number} depth - 当前深度
 * @param {number} maxDepth - 最大深度
 * @param {object} variableMap - 可选，variable ID → 名称的映射表
 */
export function toCondensedFormat(node, depth = 0, maxDepth = 10, variableMap = null) {
  if (depth > maxDepth) return "";
  if (!node) return "";
  if (SKIP_TYPES.has(node.type) && depth > 2) return "";
  if (node.visible === false) return "";

  const indent = "  ".repeat(depth);
  const line = buildCondensedLine(node, variableMap);
  let output = `${indent}${line}\n`;

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      output += toCondensedFormat(child, depth + 1, maxDepth, variableMap);
    }
  }

  return output;
}

function buildCondensedLine(node, variableMap) {
  const parts = [];

  // TYPE（优先使用语义角色）
  const semantic = inferSemanticRole(node);
  const type = semantic ? semantic.role : node.type;

  // 名称
  const name = `"${node.name}"`;

  // 尺寸
  const bbox = node.absoluteBoundingBox;
  let size = "";
  if (bbox) {
    size = `${Math.round(bbox.width)}x${Math.round(bbox.height)}`;
  }

  parts.push(`[${type} ${name}`);
  if (size) parts.push(size);

  // 背景（纯色 + 渐变）
  const allFills = (node.fills || []).filter((f) => f.visible !== false);
  const solidFills = allFills.filter((f) => f.type === "SOLID");
  const gradientFills = allFills.filter((f) => f.type?.startsWith("GRADIENT_"));

  if (node.type !== "TEXT") {
    if (gradientFills.length > 0) {
      // 优先展示渐变
      const cssGradient = gradientToCSS(gradientFills[0]);
      if (cssGradient) parts.push(`bg:${cssGradient}`);
    } else if (solidFills.length > 0) {
      parts.push(`bg:${colorToString(solidFills[0].color, solidFills[0].opacity)}`);
    }
  }

  // Effects（模糊、阴影）
  const effects = parseEffects(node.effects);
  if (effects) {
    for (const effect of effects) {
      if (effect.type === "drop-shadow") {
        parts.push(`shadow:${effect.offset.x},${effect.offset.y},${effect.radius},${effect.color}`);
      } else if (effect.type === "inner-shadow") {
        parts.push(`inner-shadow:${effect.offset.x},${effect.offset.y},${effect.radius},${effect.color}`);
      } else if (effect.type === "blur") {
        parts.push(`blur:${effect.radius}`);
      } else if (effect.type === "backdrop-blur") {
        parts.push(`backdrop-blur:${effect.radius}`);
      }
    }
  }

  // 圆角
  if (node.cornerRadius) {
    parts.push(`radius:${node.cornerRadius}`);
  } else if (node.rectangleCornerRadii) {
    const r = node.rectangleCornerRadii;
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3]) {
      if (r[0] > 0) parts.push(`radius:${r[0]}`);
    } else {
      parts.push(`radius:${r.join(",")}`);
    }
  }

  // 描边
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokes.length > 0 && strokes[0].color) {
    parts.push(`border:${node.strokeWeight || 1}px,${colorToString(strokes[0].color)}`);
  }

  // Auto Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    parts.push(node.layoutMode === "HORIZONTAL" ? "flex-row" : "flex-col");
    if (node.itemSpacing) parts.push(`gap:${node.itemSpacing}`);

    // padding
    const padding = compactPadding(node);
    if (padding && padding !== 0 && padding !== "0") {
      parts.push(`p:${padding}`);
    }

    // 对齐
    const align = mapAlign(node.primaryAxisAlignItems);
    if (align && align !== "start") parts.push(align);
    const crossAlign = mapAlign(node.counterAxisAlignItems);
    if (crossAlign && crossAlign !== "start") parts.push(`cross:${crossAlign}`);

    if (node.layoutWrap === "WRAP") parts.push("wrap");
  }

  // 透明度
  if (node.opacity !== undefined && node.opacity !== 1) {
    parts.push(`opacity:${Math.round(node.opacity * 100) / 100}`);
  }

  // 文本内容
  if (node.type === "TEXT") {
    const style = node.style || {};
    const textParts = [];
    if (style.fontSize) textParts.push(`${style.fontSize}px`);
    if (style.fontWeight) textParts.push(`/${style.fontWeight}`);
    if (textParts.length > 0) parts.push(textParts.join(""));

    // 文本颜色
    const textFills = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (textFills.length > 0) {
      parts.push(colorToString(textFills[0].color, textFills[0].opacity));
    }

    // 文本内容（截断）
    const text = (node.characters || "").slice(0, 50);
    if (text) parts.push(`"${text}"`);
  }

  // 图片填充
  if (hasImageFill(node) && node.type !== "IMAGE") {
    parts.push("has-image");
  }

  // HTML 标签建议
  if (semantic && semantic.html !== "div" && semantic.html !== "span") {
    parts.push(`<${semantic.html}>`);
  }

  // Design Token 绑定
  if (variableMap && node.boundVariables) {
    const tokenParts = [];
    for (const [prop, binding] of Object.entries(node.boundVariables)) {
      if (binding && binding.id && variableMap[binding.id]) {
        tokenParts.push(`${prop}:var(${variableMap[binding.id]})`);
      }
    }
    if (tokenParts.length > 0) {
      parts.push(`{${tokenParts.join(",")}}`);
    }
  }

  return parts.join(" ") + "]";
}
