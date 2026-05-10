export interface FigmaRequestParams {
  [key: string]: string | number | boolean | undefined | null;
}

type ResponseCallback = (path: string, params: FigmaRequestParams, data: unknown) => void;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export class FigmaClient {
  private token: string;
  private baseUrl: string;
  private cache: Map<string, CacheEntry>;
  private cacheTTL: number;
  onResponse: ResponseCallback | null;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = "https://api.figma.com/v1";
    this.cache = new Map();
    this.cacheTTL = 60000;
    this.onResponse = null;
  }

  async request(path: string, params: FigmaRequestParams = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

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

    if (this.onResponse) {
      this.onResponse(path, params, data);
    }

    this.cache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  }

  async getFile(fileKey: string, { depth }: { depth?: number } = {}): Promise<unknown> {
    return this.request(`/files/${fileKey}`, { depth });
  }

  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<unknown> {
    const ids = nodeIds.join(",");
    return this.request(`/files/${fileKey}/nodes`, { ids });
  }

  async getFileComponents(fileKey: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/components`);
  }

  async getFileStyles(fileKey: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/styles`);
  }

  async getVariables(fileKey: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/variables/local`);
  }

  async getPublishedVariables(fileKey: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/variables/published`);
  }

  async getImages(fileKey: string, nodeIds: string[], format: string = "png", scale: number = 2): Promise<unknown> {
    const ids = nodeIds.join(",");
    return this.request(`/images/${fileKey}`, { ids, format, scale });
  }

  async getComponentSet(fileKey: string, nodeId: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/nodes`, { ids: nodeId });
  }
}
