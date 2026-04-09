import { initDesktopShell } from './desktop'

initDesktopShell()

const URL_RE = /^https?:\/\/.+/i

function detectType(text: string): 'bookmark' | 'note' {
  if (URL_RE.test(text.trim())) return 'bookmark'
  return 'note'
}

function setTrayStatus(
  el: HTMLElement,
  msg: string,
  type: '' | 'success' | 'error' = ''
) {
  el.textContent = msg
  el.className = 'status ' + type
  if (type === 'success') {
    setTimeout(() => {
      el.textContent = ''
      el.className = 'status'
    }, 1500)
  }
}

async function saveItem(
  type: 'bookmark' | 'note' | 'image',
  data: Record<string, unknown>
) {
  const statusEl = document.getElementById('status')!
  try {
    setTrayStatus(statusEl, 'saving...')
    await window.desktopAPI.items.create({ type, ...data })
    window.desktopAPI._send?.('tray:item-added')
    setTrayStatus(statusEl, 'saved!', 'success')
    const input = document.getElementById('input') as HTMLInputElement
    const typePill = document.getElementById('typePill')!
    input.value = ''
    typePill.textContent = 'note'
  } catch {
    setTrayStatus(statusEl, 'failed to save', 'error')
  }
}

async function handleSubmit() {
  const input = document.getElementById('input') as HTMLInputElement
  const text = input.value.trim()
  if (!text) return

  const type = detectType(text)
  const statusEl = document.getElementById('status')!

  if (type === 'bookmark') {
    setTrayStatus(statusEl, 'fetching metadata...')
    try {
      const meta = await window.desktopAPI.metadata.fetch(text)
      await saveItem('bookmark', {
        title: meta.title || text,
        url: text,
        description: meta.description || '',
        body: meta.description || '',
        thumbnail: meta.image || undefined,
        favicon_url: meta.favicon || undefined,
        store_name: meta.siteName || undefined
      })
    } catch {
      await saveItem('bookmark', {
        title: text,
        url: text,
        description: '',
        body: ''
      })
    }
  } else {
    await saveItem('note', {
      title: text.substring(0, 100),
      description: text,
      body: text
    })
  }
}

function main() {
  const input = document.getElementById('input') as HTMLInputElement
  const dropzone = document.getElementById('dropzone')!
  const typePill = document.getElementById('typePill')!
  const statusEl = document.getElementById('status')!

  input.addEventListener('input', () => {
    const type = detectType(input.value)
    typePill.textContent = type
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    } else if (e.key === 'Escape') {
      window.desktopAPI._send?.('tray:close')
    }
  })

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropzone.classList.add('active')
  })

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('active')
  })

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropzone.classList.remove('active')

    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain')
    if (url && URL_RE.test(url.trim())) {
      input.value = url.trim()
      typePill.textContent = 'bookmark'
      void handleSubmit()
      return
    }

    for (const file of e.dataTransfer?.files ?? []) {
      if (file.type.startsWith('image/')) {
        setTrayStatus(statusEl, 'saving image...')
        try {
          const buffer = await file.arrayBuffer()
          const filename = await window.desktopAPI.images.saveData(buffer, file.name)
          if (filename) {
            await saveItem('image', {
              title: file.name,
              thumbnail: filename,
              description: '',
              body: ''
            })
          }
        } catch {
          setTrayStatus(statusEl, 'failed to save image', 'error')
        }
        return
      }
    }
  })

  document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        setTrayStatus(statusEl, 'saving image...')
        try {
          const buffer = await file.arrayBuffer()
          const ext = file.type.split('/')[1] || 'png'
          const name = `pasted-image.${ext}`
          const filename = await window.desktopAPI.images.saveData(buffer, name)
          if (filename) {
            await saveItem('image', {
              title: name,
              thumbnail: filename,
              description: '',
              body: ''
            })
          }
        } catch {
          setTrayStatus(statusEl, 'failed to save image', 'error')
        }
        return
      }
    }
  })

  window.desktopAPI._on?.('tray:focus', () => {
    input.value = ''
    input.focus()
    statusEl.textContent = ''
    statusEl.className = 'status'
  })
}

main()
