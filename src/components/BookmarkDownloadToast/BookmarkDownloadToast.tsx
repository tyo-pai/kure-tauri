import './BookmarkDownloadToast.css'

export interface BookmarkMediaDownloadJob {
  id: string
  title: string
  step: number
  total: number
  label: string
  status: 'running' | 'done' | 'error'
  error?: string
}

interface BookmarkDownloadToastProps {
  jobs: BookmarkMediaDownloadJob[]
  onDismiss: (id: string) => void
}

export function BookmarkDownloadToast({ jobs, onDismiss }: BookmarkDownloadToastProps) {
  if (jobs.length === 0) return null

  return (
    <div className="bookmark-download-toast-stack" aria-live="polite">
      {jobs.map((job) => {
        const pct = job.total > 0 ? Math.min(100, (job.step / job.total) * 100) : 0
        return (
          <div
            key={job.id}
            className={`bookmark-download-toast bookmark-download-toast--${job.status}`}
          >
            <div className="bookmark-download-toast-head">
              <span className="bookmark-download-toast-label">Save media</span>
              <button
                type="button"
                className="bookmark-download-toast-dismiss"
                onClick={() => onDismiss(job.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="bookmark-download-toast-body">
              <div className="bookmark-download-toast-title">{job.title || 'Untitled'}</div>
              {job.status === 'running' && (
                <>
                  {job.label ? (
                    <div className="bookmark-download-toast-sub">{job.label}</div>
                  ) : null}
                  <div className="bookmark-download-toast-bar-wrap">
                    <div className="bookmark-download-toast-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="bookmark-download-toast-meta">
                    {job.step} / {job.total}
                  </div>
                </>
              )}
              {job.status === 'done' && (
                <div className="bookmark-download-toast-sub">Saved to vault</div>
              )}
              {job.status === 'error' && (
                <div className="bookmark-download-toast-error">{job.error || 'Download failed'}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
