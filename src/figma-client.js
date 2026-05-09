/**
 * Figma API 客户端 - 封装所有 Figma REST API 调用
 */

export class FigmaClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = "https://api.figma.com/v1";
    this.cache = new Map();
    this.cacheTTL = 60000; // 60 秒缓存
    this.onResponse = null; // 回调钩子：(path, params, data) => void
  }

  async request(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    // 缓存检查
    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const response = await fetch(url.toString(), {
      headers: { "X-Figma-Token": this.token },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Figma API ${response.status}: ${text}`);
    }

    const data = await response.json();

    // 触发日志回调
    if (this.onResponse) {
      this.onResponse(path, params, data);
    }

    // 写入缓存
    this.cache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  }

  /** 获取文件基本信息 */
  async getFile(fileKey, { depth } = {}) {
    return this.request(`/files/${fileKey}`, { depth });
  }

  /** 获取指定节点（支持 plugin_data 获取 boundVariables） */
  async getFileNodes(fileKey, nodeIds) {
    const ids = nodeIds.join(",");
    return this.request(`/files/${fileKey}/nodes`, { ids });
  }

  /** 获取文件组件列表 */
  async getFileComponents(fileKey) {
    return this.request(`/files/${fileKey}/components`);
  }

  /** 获取文件样式列表 */
  async getFileStyles(fileKey) {
    return this.request(`/files/${fileKey}/styles`);
  }

  /** 获取 Variables 定义 */
  async getVariables(fileKey) {
    return this.request(`/files/${fileKey}/variables/local`);
  }

  /** 获取已发布的 Variables（跨文件引用） */
  async getPublishedVariables(fileKey) {
    return this.request(`/files/${fileKey}/variables/published`);
  }

  /** 获取图片导出 URL */
  async getImages(fileKey, nodeIds, format = "png", scale = 2) {
    const ids = nodeIds.join(",");
    return this.request(`/images/${fileKey}`, { ids, format, scale });
  }

  /** 获取组件集详情（包含变体信息） */
  async getComponentSet(fileKey, nodeId) {
    return this.request(`/files/${fileKey}/nodes`, { ids: nodeId });
  }
}
