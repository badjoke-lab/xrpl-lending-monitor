import './runtime-config'

declare module './runtime-config' {
  interface RuntimeConfig {
    [key: string]: unknown
  }
}
