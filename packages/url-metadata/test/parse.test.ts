import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchUrlMetadata } from '../src/index.ts'

describe('fetchUrlMetadata', () => {
  it('parses minimal og html', async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Hello" />
      <meta property="og:description" content="World" />
      <meta property="og:image" content="https://cdn.example.com/i.png" />
      </head><body></body></html>`
    const origFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    try {
      const m = await fetchUrlMetadata('https://example.com/page')
      assert.equal(m.title, 'Hello')
      assert.equal(m.description, 'World')
      assert.equal(m.image, 'https://cdn.example.com/i.png')
    } finally {
      globalThis.fetch = origFetch
    }
  })
})
