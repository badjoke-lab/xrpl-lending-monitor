import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const INDEXABLE_ROUTES = [
  '/',
  '/vaults',
  '/loan-brokers',
  '/loans',
  '/activity',
  '/audit/lifecycle',
  '/audit/archived',
  '/audit/cover-loss',
  '/epochs',
  '/search',
  '/network-status',
  '/api',
  '/methodology',
  '/about',
  '/contact',
]

function normalizeOrigin(value) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  let url
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('PUBLIC_SITE_ORIGIN or VITE_PUBLIC_SITE_ORIGIN must be an absolute http(s) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PUBLIC_SITE_ORIGIN or VITE_PUBLIC_SITE_ORIGIN must use http or https')
  }

  return url.origin
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const outputDir = process.env.DISCOVERY_OUTPUT_DIR ?? 'dist'
const configuredOrigin = process.env.PUBLIC_SITE_ORIGIN ?? process.env.VITE_PUBLIC_SITE_ORIGIN
const publicSiteOrigin = normalizeOrigin(configuredOrigin)

await mkdir(outputDir, { recursive: true })

const robotsLines = [
  'User-agent: *',
  'Allow: /',
  'Allow: /api',
  'Disallow: /api/',
]

if (publicSiteOrigin) {
  robotsLines.push('', `Sitemap: ${publicSiteOrigin}/sitemap.xml`)
}

await writeFile(path.join(outputDir, 'robots.txt'), `${robotsLines.join('\n')}\n`, 'utf8')

const sitemapPath = path.join(outputDir, 'sitemap.xml')
if (!publicSiteOrigin) {
  await rm(sitemapPath, { force: true })
  console.log('Built robots.txt without sitemap: final public site origin is not configured')
  process.exit(0)
}

const urls = INDEXABLE_ROUTES.map((route) => {
  const location = new URL(route, `${publicSiteOrigin}/`).toString()
  return `  <url><loc>${escapeXml(location)}</loc></url>`
})

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls,
  '</urlset>',
  '',
].join('\n')

await writeFile(sitemapPath, sitemap, 'utf8')
console.log(`Built robots.txt and sitemap.xml for ${publicSiteOrigin}`)
