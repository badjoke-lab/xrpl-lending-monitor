/* eslint-disable @typescript-eslint/no-explicit-any */
import './runtime-config'

declare module './runtime-config' {
  interface RuntimeConfig {
    [key: string]: any
  }
}
