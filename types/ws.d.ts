declare module "ws" {
  type Handler = (...args: any[]) => void;

  export default class WebSocket {
    constructor(url: string, options?: Record<string, unknown>);
    send(data: string | Uint8Array): void;
    close(): void;
    terminate(): void;
    once(event: "open", listener: Handler): this;
    once(event: "error", listener: Handler): this;
    on(event: "message", listener: (data: unknown, isBinary: boolean) => void): this;
    on(event: "close", listener: Handler): this;
  }
}
