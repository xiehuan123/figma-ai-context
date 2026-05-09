# Figma MCP Server

将 Figma API 数据处理成 AI 友好格式的 MCP 服务器，专为 AI 代码生成场景优化。

## 特性

- **压缩文本格式** — 比 JSON 节省 60%+ token，适合 LLM 上下文
- **SVG 自动导出** — 检测组件中的图标/矢量图形，自动导出为 SVG 并内联返回
- **API 日志系统** — 记录每次 Figma API 原始响应和优化后数据，便于调试
- **临时目录管理** — 每次启动自动清空上一次会话数据，保持干净环境
- **语义角色推断** — 自动识别 28 种 UI 语义角色（BUTTON, CARD, ICON 等）
- **Design Token 绑定** — 展示 Figma Variables 引用
- **Tailwind 输出** — 直接生成带类名的组件结构

## 安装

```bash
cd figma-mcp-server
npm install
```

## 配置

### 1. 获取 Figma Token

Figma → Settings → Personal Access Tokens → 创建 token

### 2. 配置到 Claude Desktop / LegnaCode

编辑 MCP 配置文件：

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/path/to/figma-mcp-server/src/index.js"],
      "env": {
        "FIGMA_TOKEN": "figd_你的token"
      }
    }
  }
}
```

### 3. 获取 fileKey

从 Figma 文件 URL 中提取：`figma.com/design/这一段就是fileKey/...`

## 工具列表（10 个）

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `get_file_structure` | 获取文件页面和顶层 frame 概览 | `fileKey` |
| `get_node` | 获取节点 AI 友好数据（压缩/JSON），自动导出 SVG | `fileKey`, `nodeId`, `format`, `maxTokens` |
| `get_components` | 获取所有组件列表 | `fileKey` |
| `get_component_detail` | 获取组件变体属性和内部结构 | `fileKey`, `nodeId` |
| `get_styles` | 获取颜色/文字/效果样式 | `fileKey` |
| `get_variables` | 获取 Design Tokens (Variables) | `fileKey` |
| `get_node_css` | 生成 CSS 或 Tailwind 类名 | `fileKey`, `nodeId`, `mode`, `recursive` |
| `get_page_for_codegen` | 一站式代码生成上下文，自动导出 SVG | `fileKey`, `nodeId`, `depth` |
| `get_images` | 获取节点图片导出 URL | `fileKey`, `nodeIds`, `format`, `scale` |
| `export_svg` | 手动导出指定节点为 SVG | `fileKey`, `nodeIds` |

## 使用流程

```
1. get_file_structure → 了解文件有哪些页面和 frame
2. get_node → 获取目标节点的压缩格式结构（图标自动导出 SVG）
3. get_page_for_codegen → 一站式获取代码生成完整上下文
4. get_node_css (tailwind) → 直接输出带类名的组件结构
5. export_svg → 手动导出特定节点的 SVG
```

## SVG 自动导出

当调用 `get_node` 或 `get_page_for_codegen` 时，系统会自动检测节点树中的可导出元素：

**检测规则：**
- VECTOR / LINE / STAR / ELLIPSE / BOOLEAN_OPERATION 等矢量类型
- 名称匹配 `/^(icon|ico|Icons|Basics)\b/i` 的节点
- 包含 IMAGE fill 的节点

**导出行为：**
- 调用 Figma Images API 以 SVG 格式导出
- 下载 SVG 内容并保存到 `.figma-temp/svg/` 目录
- 在工具响应末尾追加 SVG 内容（小于 10KB 时内联，否则只返回路径）
- 单次请求最多导出 20 个节点

**手动导出：**
使用 `export_svg` 工具可以指定任意节点 ID 进行 SVG 导出。

## 日志系统

每次 Figma API 调用和数据转换都会记录到 `.figma-temp/logs/` 目录：

```
.figma-temp/logs/
  2026-05-09T10-30-45-123Z_api_raw.json          # Figma API 原始响应
  2026-05-09T10-30-45-456Z_get_node_optimized.json # 优化后的数据
```

- **raw 日志**：通过 FigmaClient 的 onResponse 钩子自动捕获所有 API 响应
- **optimized 日志**：各工具处理器在返回结果前记录转换后的数据
- 写入为非阻塞操作，不影响工具响应速度

## 临时目录生命周期

所有临时数据存储在项目根目录的 `.figma-temp/` 中：

```
.figma-temp/
  logs/    # API 日志
  svg/     # 导出的 SVG 文件
```

**生命周期规则：**
- MCP Server 启动时自动清空上一次的 `.figma-temp/` 目录
- 重新创建空的 `logs/` 和 `svg/` 子目录
- 会话期间的所有数据保留到下次启动

## 核心特性

### 压缩文本格式（Condensed Format）

默认输出格式，比 JSON 节省 60%+ token：

```
[HEADER "TopNav" 1440x64 bg:#ffffff flex-row center p:0,24 gap:32 <header>]
  [IMG "Logo" 120x32 <img>]
  [NAV "MainNav" flex-row gap:24 <nav>]
    [TEXT "Products" 14px/500 #374151 "Products"]
```

格式说明：
- `[TYPE "名称" 宽x高 样式... "文本内容"]`
- TYPE 使用语义角色（HEADER, BUTTON, CARD 等）而非原始 FRAME
- 缩进表示层级关系
- `<tag>` 为建议的 HTML 元素

### 语义角色推断

自动识别 28 种语义角色：

```
HEADER, FOOTER, SIDEBAR, NAV, CARD, BUTTON, INPUT, DIALOG,
AVATAR, BADGE, ICON, IMG, LIST, FORM, SECTION, DIVIDER,
LINK, TABLE, SELECT, CHECKBOX, RADIO, TOGGLE, TOOLTIP,
BREADCRUMB, PAGINATION, PROGRESS, ALERT, COMPONENT
```

### Tailwind 模式

`get_node_css` 设置 `mode: "tailwind"`, `recursive: true` 输出带类名的 HTML：

```html
<button class="flex flex-row w-[96px] h-[36px] bg-[#4f46e5] rounded-[6px] justify-center items-center">
  <span class="text-[14px] font-[600] text-[#ffffff]">Sign Up</span>
</button>
```

### 上下文预算管理

`get_node` 的 `maxTokens` 参数（默认 4000）自动控制输出大小，超预算时智能降低深度而非粗暴截断。

## 数据处理策略

| 处理 | 说明 |
|------|------|
| 去噪 | 移除 pluginData、exportSettings、不可见节点 |
| 颜色扁平化 | RGBA 对象 → `#hex` 或 `rgba()` |
| 布局语义化 | Auto Layout → `flex-row/flex-col`、`start/center/end` |
| Padding 压缩 | 四边相同压缩为单值 |
| 响应式提示 | 基于 constraints 生成 `stretch-x`、`fluid-width` 等建议 |
| 深度控制 | 可配置递归深度 + token 预算自动截断 |
| 缓存 | 60s 内存缓存减少重复 API 调用 |

## 架构

```
src/
  index.js          # MCP Server 主入口，工具定义
  figma-client.js   # Figma REST API 客户端（带缓存和日志钩子）
  transformer.js    # 数据转换器（简化、压缩格式、CSS/Tailwind 生成）
  temp-manager.js   # 临时目录生命周期管理
  logger.js         # 日志系统
  svg-exporter.js   # SVG 检测、导出、下载
```

## 开发

```bash
npm run dev    # 带 watch 模式运行
npm start      # 正常运行
```

## 环境要求

- Node.js 18+（需要原生 fetch 支持）
- Figma Personal Access Token
