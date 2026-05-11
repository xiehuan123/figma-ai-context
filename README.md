# Figma AI Context

An MCP server that transforms Figma API data into AI-friendly formats, optimized for LLM code generation workflows.

## Features

- **Condensed Text Format** — 60%+ token savings over JSON, ideal for LLM context windows
- **One-shot Codegen** — Structure + design tokens + component definitions + color/font specs in a single call
- **CSS / Tailwind Output** — Generate style code directly, with recursive component tree support
- **SVG Export** — Detect icons/vectors and export as SVG files
- **Node Search** — Find nodes by name/type quickly, even in large files
- **Node Diff** — Compare two nodes or track changes to the same node over time via version history
- **Component Variants** — Extract all property combinations from component sets for Props interfaces
- **Style System** — Retrieve color/text/effect style definitions from files
- **Semantic Role Inference** — Auto-detect 28 UI semantic roles (BUTTON, CARD, ICON, etc.)
- **Smart Token Budget** — Auto-control output size; gracefully reduce depth when over budget
- **Resilient Requests** — Auto-retry, concurrency control, LRU cache for stability

## Installation

### Option 1: npx (Recommended)

No installation needed — use directly in your MCP client config:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-ai-context"],
      "env": {
        "FIGMA_TOKEN": "figd_your_token"
      }
    }
  }
}
```

### Option 2: Global Install

```bash
npm install -g figma-ai-context
```

```json
{
  "mcpServers": {
    "figma": {
      "command": "figma-ai-context",
      "env": {
        "FIGMA_TOKEN": "figd_your_token"
      }
    }
  }
}
```

### Option 3: From Source

```bash
git clone https://github.com/xiehuan123/figma-ai-context.git
cd figma-ai-context
npm install
npm run build
```

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/path/to/figma-ai-context/dist/index.js"],
      "env": {
        "FIGMA_TOKEN": "figd_your_token"
      }
    }
  }
}
```

### Client Config Locations

| Client | Config Path |
|--------|-------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Claude Code | `mcpServers` field in `.claude/settings.json` |
| Cursor | Settings → MCP → Add Server |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` |

### Getting a Figma Token

1. Log in to [Figma](https://www.figma.com)
2. Go to Settings → Personal Access Tokens
3. Create a new token and copy the string starting with `figd_`

## Available Tools

| Tool | Description |
|------|-------------|
| `get_file_structure` | Get page and top-level frame structure overview |
| `get_node` | Get AI-friendly node data (JSON / condensed text) |
| `get_page_for_codegen` | One-shot fetch of full codegen context |
| `get_node_css` | Convert node to CSS or Tailwind classes |
| `get_texts` | Extract all text content, supports Figma URL input |
| `search_nodes` | Search nodes by name/type for quick location |
| `get_styles` | Get color/text/effect/grid style definitions |
| `get_components` | List all components in a file |
| `get_component_variants` | Get all variant property combinations |
| `get_variables` | Get Design Variables / Tokens |
| `get_images` | Get image export URLs (PNG/SVG/PDF) |
| `export_svg` | Export nodes as SVG and save to temp directory |
| `get_icons_index` | Get summary index of exported SVGs in session |
| `diff_nodes` | Compare two nodes or track node changes over time |
| `get_versions` | List file version history for diff operations |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIGMA_TOKEN` | Yes | Figma Personal Access Token |
| `FIGMA_CACHE_TTL` | No | Cache TTL in milliseconds (default: 60000) |

## Data Processing

| Processing | Description |
|------------|-------------|
| Noise removal | Strip pluginData, exportSettings, invisible nodes |
| Color flattening | RGBA objects → `#hex` or `rgba()` |
| Layout semantics | Auto Layout → `flex-row/flex-col`, `start/center/end` |
| Padding compression | Collapse identical sides to single value |
| Depth control | Configurable recursion depth + token budget auto-truncation |
| Caching | LRU cache (max 50 entries), configurable TTL |
| Resilience | Auto-retry 429/5xx (exponential backoff), concurrency limit (max 5) |

## Project Structure

```
src/
  index.ts          # MCP Server entry, tool registration
  figma-client.ts   # Figma REST API client (retry + cache + concurrency)
  transformer.ts    # Data transform (simplify, compress, semantic inference)
  helpers.ts        # URL parsing, text extraction, CSS/Tailwind gen, node search
  diff.ts           # Node diff logic
  svg-exporter.ts   # SVG detection and export
  temp-manager.ts   # Temp directory lifecycle management
  logger.ts         # Logging system
```

## Development

```bash
npm run build      # Compile
npm run dev        # Watch mode
npm test           # Run tests
npm run test:watch # Watch mode tests
```

## Publishing

Automated via GitHub Actions. Triggered on Release creation:

1. Bump version: `npm version patch` (or `minor` / `major`)
2. Push tag: `git push origin master --tags`
3. Create a Release on GitHub targeting the tag
4. CI builds and publishes to npm and GitHub Packages

## Requirements

- Node.js 18+ (native fetch required)
- Figma Personal Access Token

---

## 中文说明

将 Figma API 数据转换为 AI 友好格式的 MCP 服务器，专为 LLM 代码生成场景优化。

### 主要特性

- **压缩文本格式** — 比 JSON 节省 60%+ token，适合 LLM 上下文
- **一站式代码生成** — 结构 + design tokens + 组件定义 + 颜色/字体规范一次获取
- **CSS / Tailwind 输出** — 直接生成样式代码，支持递归组件树
- **SVG 导出** — 检测图标/矢量图形，导出为 SVG 并保存
- **节点搜索** — 按名称/类型快速定位节点
- **节点对比** — 对比两个节点差异或通过版本历史追踪同一节点的变化
- **组件 Variants** — 提取组件集的所有属性组合，直接生成 Props 接口
- **样式系统** — 获取文件的颜色/文字/效果样式定义
- **语义角色推断** — 自动识别 28 种 UI 语义角色（BUTTON, CARD, ICON 等）
- **智能预算控制** — token 预算自动控制输出大小，超预算时智能降低深度
- **请求容错** — 自动重试、并发控制、LRU 缓存，稳定不崩溃

### 快速开始

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-ai-context"],
      "env": {
        "FIGMA_TOKEN": "figd_你的token"
      }
    }
  }
}
```

详细安装方式和工具列表请参考上方英文文档。

## License

MIT
