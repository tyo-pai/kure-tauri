interface TagChipProps {
  label: string
  onRemove?: () => void
}

export function TagChip({ label, onRemove }: TagChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        lineHeight: '16px'
      }}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          style={{
            fontSize: 9,
            color: 'var(--text-tertiary)',
            padding: 0,
            lineHeight: 1
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}
