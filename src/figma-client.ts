export interface FigmaRequestParams {
  [key: string]: string | number | boolean | undefined | null;
}

type ResponseCallback = (path: string, params: FigmaRequestParams, data: unknown) => void;

interface CacheEntry {
  data: unknown;
  timestamp: number;
  key: string;
}

export class FigmaApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FigmaApiError";
    this.status = status;
  }
}

export class FigmaClient {
  private token: string;
  private baseUrl: string;
  private cache: Map<string, CacheEntry>;
  private cacheTTL: number;
  private cacheMaxSize: number;
  private maxRetries: number;
  private maxConcurrency: number;
  private activeRequests: number;
  private requestQueue: Array<{ resolve: () => void }>;
  onResponse: ResponseCallback | null;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = "https://api.figma.com/v1";
    this.cache = new Map();
    this.cacheTTL = parseInt(process.env.FIGMA_CACHE_TTL || "60000", 10);
    this.cacheMaxSize = 50;
    this.maxRetries = 3;
    this.maxConcurrency = 5;
    this.activeRequests = 0;
    this.requestQueue = [];
    this.onResponse = null;
  }

  private async acquireConcurrency(): Promise<void> {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.requestQueue.push({ resolve });
    });
    this.activeRequests++;
  }

  private releaseConcurrency(): void {
    this.activeRequests--;
    const next = this.requestQueue.shift();
    if (next) next.resolve();
  }

  private cacheSet(key: string, data: unknown): void {
    this.cache.delete(key);
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now(), key });
  }

  private cacheGet(key: string): unknown | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (this.cacheTTL <= 0 || Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  private isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async request(path: string, params: FigmaRequestParams = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const cacheKey = url.toString();
    const cached = this.cacheGet(cacheKey);
    if (cached !== null) return cached;

    await this.acquireConcurrency();
    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          await this.sleep(delay);
        }

        const response = await fetch(url.toString(), {
          headers: { "X-Figma-Token": this.token },
        });

        if (response.ok) {
          const data = await response.json();
          if (this.onResponse) this.onResponse(path, params, data);
          this.cacheSet(cacheKey, data);
          return data;
        }

        const text = await response.text();
        lastError = new FigmaApiError(response.status, `Figma API ${response.status}: ${text}`);

        if (!this.isRetryable(response.status)) throw lastError;

        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter && attempt < this.maxRetries) {
          const retryMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryMs) && retryMs > 0) {
            await this.sleep(Math.min(retryMs, 10000));
            continue;
          }
        }
      }

      throw lastError!;
    } finally {
      this.releaseConcurrency();
    }
  }

  async getFile(fileKey: string, { depth }: { depth?: number } = {}): Promise<unknown> {
    return this.request(`/files/${fileKey}`, { depth });
  }

  async getFileNodes(fileKey: string, nodeIds: string[], version?: string): Promise<unknown> {
    const ids = nodeIds.join(",");
    return this.request(`/files/${fileKey}/nodes`, { ids, version });
  }

  async getFileVersions(fileKey: string): Promise<unknown> {
    return this.request(`/files/${fileKey}/versions`);
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
