# Figma AI Context

将 Figma API 数据转换为 AI 友好格式的 MCP 服务器，专为 LLM 代码生成场景优化。

## 特性

- **压缩文本格式** — 比 JSON 节省 60%+ token，适合 LLM 上下文
- **一站式代码生成** — 结构 + design tokens + 组件定义 + 颜色/字体规范一次获取
- **CSS / Tailwind 输出** — 直接生成样式代码，支持递归组件树
- **SVG 导出** — 检测图标/矢量图形，导出为 SVG 并保存
- **文字提取** — 支持直接传入 Figma URL 提取所有文字内容
- **语义角色推断** — 自动识别 28 种 UI 语义角色（BUTTON, CARD, ICON 等）
- **Design Token 绑定** — 展示 Figma Variables 引用
- **智能预算控制** — token 预算自动控制输出大小，超预算时智能降低深度

## 安装使用

### 方式一：npx 直接使用（推荐）

在 Claude Desktop、Cursor 或其他 MCP 客户端中配置：

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

### 方式二：本地源码运行

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

## 可用工具

| 工具 | 说明 |
|------|------|
| `get_file_structure` | 获取文件的页面和顶层 frame 结构概览 |
| `get_node` | 获取节点的 AI 友好数据（JSON / 压缩文本格式） |
| `get_page_for_codegen` | 一站式获取代码生成所需的完整上下文 |
| `get_node_css` | 将节点转换为 CSS 或 Tailwind 类名 |
| `get_texts` | 提取所有文字内容，支持直接传入 Figma URL |
| `get_components` | 获取文件中所有组件列表 |
| `get_variables` | 获取 Design Variables / Tokens |
| `get_images` | 获取节点的图片导出 URL（PNG/SVG/PDF） |
| `export_svg` | 导出节点为 SVG 并保存到临时目录 |
| `get_icons_index` | 获取当前会话已导出的 SVG 汇总索引 |

## 数据处理策略

| 处理 | 说明 |
|------|------|
| 去噪 | 移除 pluginData、exportSettings、不可见节点 |
| 颜色扁平化 | RGBA 对象 → `#hex` 或 `rgba()` |
| 布局语义化 | Auto Layout → `flex-row/flex-col`、`start/center/end` |
| Padding 压缩 | 四边相同压缩为单值 |
| 深度控制 | 可配置递归深度 + token 预算自动截断 |
| 缓存 | 60s 内存缓存减少重复 API 调用 |

## 项目结构

```
src/
  index.ts          # MCP Server 入口，工具注册
  figma-client.ts   # Figma REST API 客户端（缓存 + 日志）
  transformer.ts    # 数据转换（简化、压缩、语义推断）
  helpers.ts        # URL 解析、文字提取、CSS/Tailwind 生成
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

## 环境要求

- Node.js 18+（需要原生 fetch）
- Figma Personal Access Token

## License

MIT
