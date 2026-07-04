import * as cheerio from 'cheerio'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

const PAGES_TO_CHECK = [
  '', '/contato', '/contact', '/fale-conosco',
  '/sobre', '/about', '/equipe', '/team',
  '/time', '/quem-somos', '/sobre-nos',
  '/empresa', '/parceiros', '/trabalhe-conosco',
  '/blog', '/imprensa', '/press',
]

const TIMEOUT = 10000
const MAX_PAGES = 15

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmailValidator/1.0; +https://emailvalidator.dev)' },
    })
    if (!res.ok) return null
    const text = await res.text()
    if (text.length > 500000) return null
    return text
  } catch { return null }
}

function extractEmails(text: string, baseDomain: string): Array<{ email: string; context: string }> {
  const found = new Map<string, string>()
  const matches = text.matchAll(EMAIL_REGEX)
  const $ = cheerio.load(text)

  for (const match of matches) {
    const email = match[0].toLowerCase()
    if (email.endsWith(`.${baseDomain}`)) continue
    if (email.endsWith('.png') || email.endsWith('.jpg') || email.endsWith('.svg')) continue
    if (found.has(email)) continue

    let context = ''
    $('*').each((_, el) => {
      const $el = $(el)
      if ($el.text().includes(email)) {
        context = $el.text().trim().slice(0, 120)
        return false
      }
    })

    found.set(email, context || email)
  }

  return Array.from(found.entries()).map(([email, context]) => ({ email, context }))
}

function normalizeUrl(baseDomain: string, path: string): string {
  const base = `https://www.${baseDomain.replace(/^www\./, '')}`
  return `${base}${path}`
}

export async function crawlDomain(domain: string) {
  const results: Array<{ email: string; page: string; context: string }> = []
  const seen = new Set<string>()
  let checked = 0

  for (const path of PAGES_TO_CHECK) {
    if (checked >= MAX_PAGES) break
    const url = normalizeUrl(domain, path)
    
    const html = await fetchPage(url)
    if (!html) continue
    checked++

    const emails = extractEmails(html, domain)
    for (const { email, context } of emails) {
      if (!seen.has(email)) {
        seen.add(email)
        results.push({ email, page: url, context })
      }
    }
  }

  if (checked === 0) {
    const url = normalizeUrl(domain, '')
    const html = await fetchPage(url)
    if (html) {
      const emails = extractEmails(html, domain)
      for (const { email, context } of emails) {
        if (!seen.has(email)) {
          seen.add(email)
          results.push({ email, page: url, context })
        }
      }
    }
  }

  return results
}
