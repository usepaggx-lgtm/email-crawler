import * as cheerio from 'cheerio'

const TIMEOUT = 10000

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmailValidator/1.0; +https://emailvalidator.dev)' },
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > 300000 ? null : text
  } catch { return null }
}

function extractName(text: string): string {
  const $ = cheerio.load(text)
  const title = $('title').text()
  const h1 = $('h1').first().text()
  const metaDesc = $('meta[name="description"]').attr('content') || ''
  const ogTitle = $('meta[property="og:title"]').attr('content') || ''
  return ogTitle || h1 || title || metaDesc.split(' - ')[0] || ''
}

export async function enrichEmail(email: string) {
  const domain = email.split('@')[1]
  const localPart = email.split('@')[0]

  const nameFromEmail = localPart
    .split(/[._\-]/)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')

  const result: any = {
    email,
    name: nameFromEmail,
    firstName: nameFromEmail.split(' ')[0] || '',
    lastName: nameFromEmail.split(' ').slice(1).join(' ') || '',
    company: domain.replace(/\.com(\.[a-z]{2})?$/, '').replace(/\./g, ' '),
    domain,
    title: '',
    social: { linkedin: '', twitter: '' },
    source: 'pattern',
  }

  const companyName = domain.split('.')[0]
  result.company = companyName.charAt(0).toUpperCase() + companyName.slice(1)

  const urls = [
    `https://www.${domain}/`,
    `https://www.${domain}/sobre`,
    `https://www.${domain}/about`,
    `https://www.${domain}/equipe`,
    `https://www.${domain}/team`,
  ]

  for (const url of urls) {
    const html = await fetchPage(url)
    if (!html) continue

    const name = extractName(html)
    if (name && name !== result.company) {
      result.company = name
      result.source = 'crawl'
    }

    const $ = cheerio.load(html)
    const lower = html.toLowerCase()

    const nameParts = nameFromEmail.split(' ')
    const firstName = nameParts[0]?.toLowerCase() || ''
    const lastName = nameParts.slice(1).join(' ').toLowerCase() || ''

    if (firstName && lastName) {
      const fullName = `${firstName} ${lastName}`

      $('h2, h3, h4, p, span, div').each((_, el) => {
        const $el = $(el)
        const text = $el.text().toLowerCase()
        if (text.includes(firstName) && text.includes(lastName)) {
          const nameText = $el.text().trim()
          if (nameText.length < 100) {
            result.name = nameText
          }

          const parent = $el.parent()
          const parentText = parent.text()
          const lines = parentText.split('\n').map(l => l.trim()).filter(Boolean)

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(firstName)) {
              if (i > 0) result.title = lines[i - 1].replace(/^[•\-]\s*/, '')
              break
            }
          }

          return false
        }
      })
    }

    if (result.source === 'crawl') break
  }

  const lower = nameFromEmail.toLowerCase()
  
  return result
}
