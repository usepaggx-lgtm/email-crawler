const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const TIMEOUT = 15000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface FoundEmail {
  email: string
  source: string
  context: string
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > 800000 ? null : text
  } catch { return null }
}

function extractEmails(text: string, domain?: string): Set<string> {
  const found = new Set<string>()
  const matches = text.matchAll(EMAIL_REGEX)
  for (const m of matches) {
    const email = m[0].toLowerCase()
    if (email.includes('.png') || email.includes('.jpg') || email.includes('.svg') || email.includes('.ico') || email.includes('.css')) continue
    if (domain && email.endsWith(`.${domain}`)) continue
    if (email.endsWith('@example.com') || email.endsWith('@domain.com') || email.endsWith('@test.com')) continue
    found.add(email)
  }
  return found
}

async function searchDuckDuckGo(query: string): Promise<string | null> {
  return fetchPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
}
async function searchBing(query: string): Promise<string | null> {
  return fetchPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30`)
}

async function searchViaDuckDuckGo(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const dorks = [
    `site:${domain} email OR contato OR contact OR faleconosco`,
    `site:${domain} "%40${domain}"`,
    `site:${domain} intitle:contato OR intitle:contact OR intitle:equipe OR intitle:team`,
    `site:${domain} inurl:contato OR inurl:contact OR inurl:equipe OR inurl:team OR inurl:sobre OR inurl:about`,
    `site:${domain} carreiras OR trabalhe-conosco OR jobs`,
    `site:${domain} blog OR imprensa OR press OR comunicado`,
    `site:${domain} pdf`,
    `site:${domain} whitepaper OR white-paper OR guia OR ebook`,
    `site:${domain} forum OR foruns`,
    `"@${domain}" linkedin`,
    `"@${domain}" github`,
    `"@${domain}" twitter`,
    `"@${domain}" mastodon`,
    `"@${domain}" filetype:pdf`,
    `"@${domain}" filetype:doc OR filetype:docx OR filetype:xls OR filetype:csv`,
    `"@${domain}" contato OR email OR telefone`,
    `${domain} CEO OR Diretor OR Founder email contato`,
    `${domain} vendas OR comercial OR sac email`,
    `${domain} rh OR recursos-humanos OR jobs email`,
  ]

  for (const dork of dorks) {
    const html = await searchDuckDuckGo(dork)
    if (!html) continue
    const emails = extractEmails(html, domain)
    for (const e of emails) {
      if (!found.has(e)) found.set(e, { email: e, source: 'duckduckgo', context: `Found via search: ${dork.slice(0, 60)}` })
    }
    if (found.size > 200) break
  }

  return found
}

async function searchViaBing(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const dorks = [
    `site:${domain} email OR contato OR contact`,
    `"@${domain}"`,
    `"${domain}" email contato`,
  ]

  for (const dork of dorks) {
    const html = await searchBing(dork)
    if (!html) continue
    const emails = extractEmails(html, domain)
    for (const e of emails) {
      if (!found.has(e)) found.set(e, { email: e, source: 'bing', context: `Found via Bing` })
    }
  }

  return found
}

async function searchGithub(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `"@${domain}"`,
    `"${domain}" email`,
  ]

  for (const q of queries) {
    try {
      const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=30&sort=indexed`, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'EmailValidator' },
      })
      if (!res.ok) continue
      const data: any = await res.json()
      if (!data.items) continue
      for (const item of data.items.slice(0, 20)) {
        const rawUrl = item.html_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
        const raw = await fetchPage(rawUrl)
        if (raw) {
          const emails = extractEmails(raw, domain)
          for (const e of emails) {
            if (e.endsWith(`@${domain}`) && !found.has(e)) found.set(e, { email: e, source: 'github', context: `Found in: ${item.repository?.full_name || 'repo'}` })
          }
        }
      }
    } catch {}
  }

  return found
}

async function searchWhois(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()

  const whoisSources = [
    `https://www.whois.com/whois/${domain}`,
    `https://www.registry.net.br/whois/${domain}`,
    `https://www.whois.net/whois/${domain}`,
    `https://www.who.is/whois/${domain}`,
    `https://whois.domaintools.com/${domain}`,
  ]

  for (const url of whoisSources) {
    const html = await fetchPage(url)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (!e.includes('whois') && !e.includes('example') && !e.includes('@iana.org') && !found.has(e)) {
        found.set(e, { email: e, source: 'whois', context: `Found in WHOIS records` })
      }
    }
  }

  return found
}

async function searchCMSLeaks(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const leakUrls = [
    `https://${domain}/wp-json/wp/v2/users`,
    `https://${domain}/.well-known/security.txt`,
    `https://${domain}/sitemap.xml`,
    `https://${domain}/page-sitemap.xml`,
    `https://${domain}/authors.xml`,
    `https://${domain}/authors/feed`,
    `https://${domain}/feed/atom`,
    `https://${domain}/?author=1`,
    `https://${domain}/?author=2`,
    `https://${domain}/?author=3`,
    `https://${domain}/author/1`,
    `https://${domain}/blog/author/admin`,
    `https://${domain}/api/users`,
    `https://${domain}/.env`,
    `https://${domain}/.git/config`,
    `https://${domain}/composer.json`,
    `https://${domain}/package.json`,
    `https://${domain}/README.md`,
    `https://${domain}/CONTRIBUTORS.md`,
    `https://${domain}/CHANGELOG.md`,
  ]

  for (const url of leakUrls) {
    const text = await fetchPage(url)
    if (!text || text.length < 20) continue
    const emails = extractEmails(text)
    for (const e of emails) {
      if (e.endsWith(`@${domain}`) && !found.has(e)) found.set(e, { email: e, source: 'cms_leak', context: `Found in ${url}` })
    }
  }

  return found
}

async function searchLinkedinDork(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `site:linkedin.com/in "${domain}" email`,
    `site:linkedin.com "${domain}" contato`,
    `site:br.linkedin.com "${domain}"`,
  ]

  for (const q of queries) {
    const html = await searchDuckDuckGo(q)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (!found.has(e)) found.set(e, { email: e, source: 'linkedin_dork', context: `Found via LinkedIn search` })
    }
  }

  return found
}

async function searchSocialMedia(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `site:twitter.com "${domain}" email`,
    `site:x.com "${domain}" email`,
    `site:mastodon.social "${domain}"`,
    `site:mastodon.online "${domain}"`,
    `site:threads.net "${domain}"`,
  ]

  for (const q of queries) {
    const html = await searchDuckDuckGo(q)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (!found.has(e)) found.set(e, { email: e, source: 'social_media', context: `Found via social media search` })
    }
  }

  return found
}

async function searchForumsAndDiscussions(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `site:reddit.com "${domain}"`,
    `site:stackoverflow.com "${domain}"`,
    `site:quora.com "${domain}"`,
    `site:medium.com "${domain}"`,
    `site:dev.to "${domain}"`,
    `site:groups.google.com "${domain}"`,
    `site:${domain} forum`,
  ]

  for (const q of queries) {
    const html = await searchDuckDuckGo(q)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (e.endsWith(`@${domain}`) && !found.has(e)) found.set(e, { email: e, source: 'forum', context: `Found in discussions` })
    }
  }

  return found
}

async function searchPublicDocuments(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `"@${domain}" filetype:pdf`,
    `"@${domain}" filetype:doc OR filetype:docx`,
    `"@${domain}" filetype:xls OR filetype:xlsx OR filetype:csv`,
    `"@${domain}" filetype:ppt OR filetype:pptx`,
    `"@${domain}" filetype:txt`,
    `"@${domain}" filetype:xml`,
    `"@${domain}" filetype:json`,
    `"@${domain}" filetype:yml OR filetype:yaml`,
    `"@${domain}" filetype:md`,
    `"@${domain}" filetype:sql`,
  ]

  for (const q of queries) {
    const html = await searchDuckDuckGo(q)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (e.endsWith(`@${domain}`) && !found.has(e)) found.set(e, { email: e, source: 'document', context: `Found in public documents` })
    }
  }

  return found
}

async function searchPublicDatabases(domain: string): Promise<Map<string, FoundEmail>> {
  const found = new Map<string, FoundEmail>()
  const queries = [
    `"${domain}" site:cnpj.info`,
    `"${domain}" site:empresas.com.br`,
    `"${domain}" site:listas.telelistas.net`,
    `"${domain}" site:solucoes.receita.fazenda`,
  ]

  for (const q of queries) {
    const html = await searchDuckDuckGo(q)
    if (!html) continue
    const emails = extractEmails(html)
    for (const e of emails) {
      if (!found.has(e)) found.set(e, { email: e, source: 'public_db', context: `Found in public database` })
    }
  }

  return found
}

function generateCommonPatterns(domain: string): Map<string, FoundEmail> {
  const found = new Map<string, FoundEmail>()
  const patterns = [
    'info', 'contact', 'contato', 'admin', 'webmaster', 'noreply',
    'hello', 'hi', 'office', 'support', 'suporte', 'sac',
    'comercial', 'vendas', 'sales', 'marketing', 'rh', 'jobs',
    'ti', 'financeiro', 'adm', 'presidencia', 'diretoria',
    'ouvidoria', 'faleconosco', 'newsletter', 'imprensa', 'press',
    'partner', 'parceiros', 'trabalhe-conosco', 'curriculo',
    'propostas', 'orçamento', 'cobranca', 'juridico',
    'ouvidoria', 'sugestoes', 'reclamacoes', 'privacidade',
  ]

  for (const p of patterns) {
    found.set(`${p}@${domain}`, { email: `${p}@${domain}`, source: 'pattern', context: `Common pattern` })
  }

  return found
}

export async function searchPublicSources(domain: string): Promise<FoundEmail[]> {
  const all = new Map<string, FoundEmail>()

  const searches = [
    searchViaDuckDuckGo(domain),
    searchViaBing(domain),
    searchGithub(domain),
    searchWhois(domain),
    searchCMSLeaks(domain),
    searchLinkedinDork(domain),
    searchSocialMedia(domain),
    searchForumsAndDiscussions(domain),
    searchPublicDocuments(domain),
    searchPublicDatabases(domain),
  ]

  const results = await Promise.allSettled(searches)
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const [email, data] of r.value) {
      if (!all.has(email)) all.set(email, data)
    }
  }

  const patterns = generateCommonPatterns(domain)
  for (const [email, data] of patterns) {
    if (!all.has(email)) all.set(email, data)
  }

  return Array.from(all.values())
}
