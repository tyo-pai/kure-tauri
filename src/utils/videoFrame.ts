type VideoFrameCapableElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Resolves only after a video has a real frame ready to paint.
 * This avoids swapping a poster image out too early and flashing black.
 */
export function waitForVideoFirstFrame(video: HTMLVideoElement, onReady: () => void): () => void {
  const frameVideo = video as VideoFrameCapableElement
  let cancelled = false
  let rafA = 0
  let rafB = 0

  const finish = () => {
    if (cancelled) return
    rafA = window.requestAnimationFrame(() => {
      if (cancelled) return
      rafB = window.requestAnimationFrame(() => {
        if (!cancelled) {
          onReady()
        }
      })
    })
  }

  if (typeof frameVideo.requestVideoFrameCallback === 'function') {
    const handle = frameVideo.requestVideoFrameCallback(() => {
      finish()
    })

    return () => {
      cancelled = true
      if (typeof frameVideo.cancelVideoFrameCallback === 'function') {
        frameVideo.cancelVideoFrameCallback(handle)
      }
      window.cancelAnimationFrame(rafA)
      window.cancelAnimationFrame(rafB)
    }
  }

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    finish()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafA)
      window.cancelAnimationFrame(rafB)
    }
  }

  const handleLoadedData = () => {
    finish()
  }

  video.addEventListener('loadeddata', handleLoadedData, { once: true })

  return () => {
    cancelled = true
    video.removeEventListener('loadeddata', handleLoadedData)
    window.cancelAnimationFrame(rafA)
    window.cancelAnimationFrame(rafB)
  }
}
