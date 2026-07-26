import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

interface SpillBucketStoreOptions<T> {
  root: string
  bucketCount: number
  maxBufferedRecords: number
  serialize: (value: T) => string
  parse: (value: string) => T
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`)
  return value
}

function bucketName(bucket: number): string {
  return String(bucket).padStart(4, '0')
}

export class SpillBucketStore<T> {
  private readonly root: string
  private readonly bucketCount: number
  private readonly maxBufferedRecords: number
  private readonly serialize: (value: T) => string
  private readonly parse: (value: string) => T
  private readonly buffers: T[][]
  private readonly chunkCounts: number[]
  private bufferedRecords = 0

  constructor(options: SpillBucketStoreOptions<T>) {
    this.root = options.root
    this.bucketCount = positiveSafeInteger(options.bucketCount, 'bucketCount')
    this.maxBufferedRecords = positiveSafeInteger(options.maxBufferedRecords, 'maxBufferedRecords')
    this.serialize = options.serialize
    this.parse = options.parse
    this.buffers = Array.from({ length: this.bucketCount }, () => [])
    this.chunkCounts = Array.from({ length: this.bucketCount }, () => 0)
  }

  async initialize(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
    await mkdir(this.root, { recursive: true })
    for (const buffer of this.buffers) buffer.length = 0
    this.chunkCounts.fill(0)
    this.bufferedRecords = 0
  }

  add(bucket: number, value: T): boolean {
    if (!Number.isSafeInteger(bucket) || bucket < 0 || bucket >= this.bucketCount) {
      throw new Error(`bucket must be between 0 and ${this.bucketCount - 1}`)
    }
    this.buffers[bucket]!.push(value)
    this.bufferedRecords += 1
    return this.bufferedRecords >= this.maxBufferedRecords
  }

  async flush(): Promise<void> {
    if (this.bufferedRecords === 0) return
    for (let bucket = 0; bucket < this.bucketCount; bucket += 1) {
      const records = this.buffers[bucket]!
      if (records.length === 0) continue
      const chunk = this.chunkCounts[bucket]!
      const text = `${records.map(this.serialize).join('\n')}\n`
      const bytes = gzipSync(Buffer.from(text, 'utf8'), { level: 6 })
      await writeFile(join(this.root, `${bucketName(bucket)}-${String(chunk).padStart(6, '0')}.ndjson.gz`), bytes)
      this.chunkCounts[bucket] = chunk + 1
      records.length = 0
    }
    this.bufferedRecords = 0
  }

  async readBucket(bucket: number): Promise<T[]> {
    if (!Number.isSafeInteger(bucket) || bucket < 0 || bucket >= this.bucketCount) {
      throw new Error(`bucket must be between 0 and ${this.bucketCount - 1}`)
    }
    const result: T[] = []
    for (let chunk = 0; chunk < this.chunkCounts[bucket]!; chunk += 1) {
      const bytes = await readFile(join(this.root, `${bucketName(bucket)}-${String(chunk).padStart(6, '0')}.ndjson.gz`))
      const text = gunzipSync(bytes).toString('utf8')
      for (const line of text.split('\n')) {
        if (line.length > 0) result.push(this.parse(line))
      }
    }
    return result
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }
}
