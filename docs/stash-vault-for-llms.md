# Stash vault format (for humans, LLMs, and automation)

This file is **not** a Stash item. Stash only indexes Markdown files whose YAML frontmatter includes **both** `id` and `type`. This document has **no** such frontmatter, so it will not appear in the library.

Use this spec when creating or migrating `.md` files into a Stash vault (e.g. from Cursor, shell scripts, or a mobile companion). The desktop app indexes the vault **recursively** and picks up new files from sync (iCloud Drive, etc.).

## Layout

- **Vault root:** Any folder the user selects (often `…/iCloud Drive/Stash`).
- **Reserved directory names** (do not put primary notes inside these — they are skipped when scanning):
  - `.stash` — app metadata and cache
  - `_assets` — images and downloads referenced from notes
  - `images` — legacy image folder
- **Nesting:** You may use subfolders arbitrarily (e.g. `Research/papers/note.md`). The app derives `folder_path` from the relative directory. The sidebar “folder” label uses the **first** path segment only.

## Required frontmatter

Every indexed note **must** include:

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Stable identifier. Desktop uses URL-safe base64 from **12 random bytes** (≈16 chars), e.g. `crypto.randomBytes(12).toString('base64url')` in Node. |
| `type` | string | One of: `bookmark`, `note`, `image`, `wishlist`. |

If either is missing, Stash **ignores** the file (no error).

## Recommended filename

Match the desktop convention:

`{slugify(title)}-{first_6_chars_of_id}.md`

Where `slugify` lowercases, strips non-alphanumeric (except spaces/hyphens), collapses whitespace to `-`, truncates to 80 chars, default `untitled`. **Identity is `id` in frontmatter**, not the filename.

## Common frontmatter keys (mirror the app)

Bookmarks and other items often include:

- `title` (string)
- `status` — e.g. `unread` (default), `archived`, `favorite`
- `created_at`, `updated_at` — ISO 8601 timestamps
- `url` — for `bookmark` / `wishlist`
- `description`, `body` — text; body is the Markdown content **below** the frontmatter fence
- `thumbnail`, `favicon_url`, `bookmark_media`, `preview_video_url`
- `bookmark_author`, `bookmark_post_text` (social context)
- `price`, `store_name` (wishlist)
- `tags` — array of strings
- `ai_summary`, `ai_description`, `ocr_text`
- `colors`, `embedding` — optional; usually set by the app

Omit optional keys rather than leaving empty strings when possible.

## Example: bookmark

```yaml
---
id: AbCdEfGhIjKlMnO
type: bookmark
title: Example Domain
status: unread
created_at: '2026-03-28T12:00:00.000Z'
updated_at: '2026-03-28T12:00:00.000Z'
url: https://example.com
description: Illustrative link for tooling.
favicon_url: https://example.com/favicon.ico
---

Illustrative link for tooling.
```

## Example: note

```yaml
---
id: ZzYyXxWwVuUtTsS
type: note
title: Meeting notes
status: unread
created_at: '2026-03-28T12:00:00.000Z'
updated_at: '2026-03-28T12:00:00.000Z'
---

## Agenda

- …
```

## Images

Random image files in the vault are **not** auto-imported as items. Put assets under `_assets` (or `images`) and reference them from frontmatter (`thumbnail`) or Markdown links.

## Mobile companion

The Stash **Expo** app can write bookmark files into the same vault folder. Desktop Stash will index them after iCloud (or another sync provider) delivers the files.
