declare module 'cloudflare:sockets' {
  interface SocketAddress {
    hostname: string
    port: number
  }

  interface SocketOptions {
    secureTransport?: 'off' | 'on' | 'starttls'
    allowHalfOpen?: boolean
  }

  interface SocketInfo {
    remoteAddress: string | null
    localAddress: string | null
  }

  interface Socket {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<Uint8Array>
    opened: Promise<SocketInfo>
    closed: Promise<void>
    close(): Promise<void>
  }

  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket
}
