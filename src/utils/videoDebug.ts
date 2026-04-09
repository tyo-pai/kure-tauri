import type { SyntheticEvent } from 'react'

/** Filter DevTools console by this string. Set `localStorage.setItem('kure:videoDebug', '0')` to silence. */
export const VIDEO_DEBUG_TAG = '[kure:video]'

function videoDebugEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('kure:videoDebug') !== '0'
  } catch {
    return true
  }
}

function mediaErrorLabel(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'MEDIA_ERR_ABORTED'
    case 2:
      return 'MEDIA_ERR_NETWORK'
    case 3:
      return 'MEDIA_ERR_DECODE'
    case 4:
      return 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    default:
      return `UNKNOWN(${code})`
  }
}

export type VideoDebugHandlersOptions = {
  src?: string | null
  onLoadedMetadata?: (e: SyntheticEvent<HTMLVideoElement>) => void
}

/**
 * Spread onto `<video>` to log load / error / buffering (helps diagnose CDN / CORS / hotlink issues).
 */
export function videoDebugHandlers(context: string, options: VideoDebugHandlersOptions = {}) {
  const { src: srcHint, onLoadedMetadata } = options

  return {
    onLoadStart(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      const v = e.currentTarget
      console.log(VIDEO_DEBUG_TAG, context, 'loadstart', {
        currentSrc: v.currentSrc,
        srcAttr: srcHint ?? v.getAttribute('src')
      })
    },

    onLoadedMetadata(e: SyntheticEvent<HTMLVideoElement>) {
      if (videoDebugEnabled()) {
        const v = e.currentTarget
        console.log(VIDEO_DEBUG_TAG, context, 'loadedmetadata', {
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          duration: Number.isFinite(v.duration) ? v.duration : null,
          currentSrc: v.currentSrc
        })
      }
      onLoadedMetadata?.(e)
    },

    onCanPlay(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      const v = e.currentTarget
      console.log(VIDEO_DEBUG_TAG, context, 'canplay', { currentSrc: v.currentSrc })
    },

    onWaiting(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      const v = e.currentTarget
      console.log(VIDEO_DEBUG_TAG, context, 'waiting (buffering)', {
        currentTime: v.currentTime,
        readyState: v.readyState
      })
    },

    onStalled(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      console.warn(VIDEO_DEBUG_TAG, context, 'stalled', { currentSrc: e.currentTarget.currentSrc })
    },

    onError(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      const v = e.currentTarget
      const err = v.error
      console.warn(VIDEO_DEBUG_TAG, context, 'playback error', {
        currentSrc: v.currentSrc,
        networkState: v.networkState,
        readyState: v.readyState,
        errorCode: err?.code,
        errorName: err ? mediaErrorLabel(err.code) : null,
        errorMessage: err?.message || '(empty)'
      })
    },

    onAbort(e: SyntheticEvent<HTMLVideoElement>) {
      if (!videoDebugEnabled()) return
      console.log(VIDEO_DEBUG_TAG, context, 'abort', { currentSrc: e.currentTarget.currentSrc })
    }
  }
}
