import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it, before } from 'node:test'
import matter from 'gray-matter'
import { bookmarkFileName, buildBookmarkMarkdown, genId, slugify } from '../index.ts'

before(() => {
  if (!globalThis.crypto?.getRandomValues) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  }
})

describe('vault-io', () => {
  it('slugify matches expected shaping', () => {
    assert.equal(slugify('Hello World!'), 'hello-world')
    assert.equal(slugify(''), 'untitled')
  })

  it('genId is 16-char base64url-like', () => {
    const id = genId()
    assert.match(id, /^[A-Za-z0-9_-]+$/)
    assert.ok(id.length >= 12)
  })

  it('bookmarkFileName uses short id prefix', () => {
    const id = 'abcdefghijklmnop'
    assert.equal(bookmarkFileName('My Title', id), `my-title-${id.slice(0, 6)}.md`)
  })

  it('buildBookmarkMarkdown parses with id and type', () => {
    const { markdown, fileName } = buildBookmarkMarkdown({
      title: 'Example',
      url: 'https://example.com',
      description: 'A site'
    })
    const parsed = matter(markdown)
    assert.equal(parsed.data.id && parsed.data.type ? true : false, true)
    assert.equal(parsed.data.type, 'bookmark')
    assert.equal(parsed.data.url, 'https://example.com')
    assert.ok(fileName.endsWith('.md'))
  })
})
