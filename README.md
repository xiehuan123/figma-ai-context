# Figma AI Context

将 Figma API 数据转换为 AI 友好格式的 MCP 服务器，专为 LLM 代码生成场景优化。

## 特性

- **压缩文本格式** — 比 JSON 节省 60%+ token，适合 LLM 上下文
- **一站式代码生成** — 结构 + design tokens + 组件定义 + 颜色/字体规范一次获取
- **CSS / Tailwind 输出** — 直接生成样式代码，支持递归组件树
- **SVG 导出** — 检测图标/矢量图形，导出为 SVG 并保存
- **节点搜索** — 按名称/类型快速定位节点，大文件不再迷路
- **节点对比** — 对比两个节点差异或同一节点的前后变化
- **组件 Variants** — 提取组件集的所有属性组合，直接生成 Props 接口
- **样式系统** — 获取文件的颜色/文字/效果样式定义
- **语义角色推断** — 自动识别 28 种 UI 语义角色（BUTTON, CARD, ICON 等）
- **智能预算控制** — token 预算自动控制输出大小，超预算时智能降低深度
- **请求容错** — 自动重试、并发控制、LRU 缓存，稳定不崩溃

## 安装使用

### 方式一：npx 直接使用（推荐）

无需安装，在 MCP 客户端配置中直接使用：

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

### 方式二：全局安装

```bash
npm install -g figma-ai-context
```

```json
{
  "mcpServers": {
    "figma": {
      "command": "figma-ai-context",
      "env": {
        "FIGMA_TOKEN": "figd_你的token"
      }
    }
  }
}
```

### 方式三：本地源码运行

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
        "FIGMA_TOKEN": "figd_你的token"
      }
    }
  }
}
```

### 各客户端配置位置

| 客户端 | 配置文件路径 |
|--------|-------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Claude Code | `.claude/settings.json` 中的 `mcpServers` 字段 |
| Cursor | Settings → MCP → Add Server |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` |

### 获取 Figma Token

1. 登录 [Figma](https://www.figma.com)
2. 进入 Settings → Personal Access Tokens
3. 创建新 token，复制以 `figd_` 开头的字符串

## 可用工具

| 工具 | 说明 |
|------|------|
| `get_file_structure` | 获取文件的页面和顶层 frame 结构概览 |
| `get_node` | 获取节点的 AI 友好数据（JSON / 压缩文本格式） |
| `get_page_for_codegen` | 一站式获取代码生成所需的完整上下文 |
| `get_node_css` | 将节点转换为 CSS 或 Tailwind 类名 |
| `get_texts` | 提取所有文字内容，支持直接传入 Figma URL |
| `search_nodes` | 按名称/类型搜索节点，快速定位组件 |
| `get_styles` | 获取文件的颜色/文字/效果/网格样式定义 |
| `get_components` | 获取文件中所有组件列表 |
| `get_component_variants` | 获取组件集的所有 variant 属性组合 |
| `get_variables` | 获取 Design Variables / Tokens |
| `get_images` | 获取节点的图片导出 URL（PNG/SVG/PDF） |
| `export_svg` | 导出节点为 SVG 并保存到临时目录 |
| `get_icons_index` | 获取当前会话已导出的 SVG 汇总索引 |
| `diff_nodes` | 对比两个节点差异或同一节点的前后变化 |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FIGMA_TOKEN` | 是 | Figma Personal Access Token |
| `FIGMA_CACHE_TTL` | 否 | 缓存过期时间（毫秒），默认 60000 |

## 数据处理策略

| 处理 | 说明 |
|------|------|
| 去噪 | 移除 pluginData、exportSettings、不可见节点 |
| 颜色扁平化 | RGBA 对象 → `#hex` 或 `rgba()` |
| 布局语义化 | Auto Layout → `flex-row/flex-col`、`start/center/end` |
| Padding 压缩 | 四边相同压缩为单值 |
| 深度控制 | 可配置递归深度 + token 预算自动截断 |
| 缓存 | LRU 缓存（最大 50 条），可配置 TTL |
| 容错 | 自动重试 429/5xx（指数退避），并发控制（最大 5 请求） |

## 项目结构

```
src/
  index.ts          # MCP Server 入口，工具注册
  figma-client.ts   # Figma REST API 客户端（重试 + 缓存 + 并发控制）
  transformer.ts    # 数据转换（简化、压缩、语义推断）
  helpers.ts        # URL 解析、文字提取、CSS/Tailwind 生成、节点搜索
  diff.ts           # 节点对比逻辑
  svg-exporter.ts   # SVG 检测与导出
  temp-manager.ts   # 临时目录生命周期管理
  logger.ts         # 日志系统
```

## 开发

```bash
npm run build      # 编译
npm run dev        # watch 模式
npm test           # 运行测试
npm run test:watch # watch 模式测试
```

## 发布

项目通过 GitHub Actions 自动发布。创建 Release 时自动触发：

1. 更新版本号：`npm version patch`（或 `minor` / `major`）
2. 推送 tag：`git push origin master --tags`
3. 在 GitHub 上创建 Release，选择对应 tag
4. CI 自动构建并发布到 npm 和 GitHub Packages

## 环境要求

- Node.js 18+（需要原生 fetch）
- Figma Personal Access Token

## License

MIT
