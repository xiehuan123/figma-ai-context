# CLAUDE.md

## 项目概述

figma-ai-context 是一个 MCP (Model Context Protocol) 服务器，将 Figma API 数据转换为 AI 友好格式，专为 LLM 代码生成场景优化。

## 技术栈

- TypeScript + Node.js (ESM)
- @modelcontextprotocol/sdk — MCP 协议实现
- Vitest — 测试框架
- 无前端，纯 CLI/Server

## 常用命令

```bash
npm run build      # TypeScript 编译
npm run dev        # watch 模式编译
npm start          # 运行 MCP Server
npm test           # 运行测试
npm run test:watch # watch 模式测试
```

## 项目结构

```
src/
  index.ts          # MCP Server 入口，所有工具注册
  figma-client.ts   # Figma REST API 客户端（缓存 + 日志钩子）
  transformer.ts    # 数据转换（简化、压缩格式、CSS/Tailwind）
  temp-manager.ts   # 临时目录生命周期管理
  logger.ts         # 日志系统
  svg-exporter.ts   # SVG 检测与导出
tests/
  *.test.ts         # 对应模块的单元测试
```

## 开发约定

- 所有源码在 `src/`，编译输出到 `dist/`
- 使用 ESM (`"type": "module"`)，import 路径带 `.js` 后缀
- 环境变量 `FIGMA_TOKEN` 提供 Figma API 认证
- 新增工具在 `src/index.ts` 中通过 `server.registerTool()` 注册
- 辅助函数放在对应模块（transformer.ts 处理数据转换，figma-client.ts 处理 API）
- 修改后运行 `npm run build && npm test` 确认无误

## 环境要求

- Node.js 18+（需要原生 fetch）
- Figma Personal Access Token
