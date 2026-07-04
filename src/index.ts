import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { crawlDomain } from './crawler'
import { searchPublicSources } from './public'
import { enrichEmail } from './enricher'

const app = new Hono()

app.use('/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'] }))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

app.post('/crawl', async (c) => {
  try {
    const { domain } = await c.req.json() as { domain: string }
    if (!domain) return c.json({ error: 'Domain required' }, 400)

    const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
    const [siteEmails, publicEmails] = await Promise.all([
      crawlDomain(clean),
      searchPublicSources(clean),
    ])

    const seen = new Set<string>()
    const all = [...siteEmails, ...publicEmails].filter(e => {
      if (seen.has(e.email)) return false
      seen.add(e.email)
      return true
    })

    return c.json({
      domain: clean,
      total: all.length,
      sources: { website: siteEmails.length, public: publicEmails.length },
      emails: all,
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Crawl failed' }, 500)
  }
})

app.post('/enrich', async (c) => {
  try {
    const { email } = await c.req.json() as { email: string }
    if (!email || !email.includes('@')) return c.json({ error: 'Valid email required' }, 400)
    const result = await enrichEmail(email)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message || 'Enrich failed' }, 500)
  }
})

const port = parseInt(process.env.PORT || '3002')
console.log(`Crawler service starting on port ${port}`)
serve({ fetch: app.fetch, port })
