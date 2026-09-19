export interface LoadingSpinnerProps {
  /** Announced to screen readers and shown beneath the spinner. */
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

const SIZES: Record<NonNullable<LoadingSpinnerProps['size']>, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-4',
}

export function LoadingSpinner({ label = 'Loading', size = 'md' }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={`${SIZES[size]} animate-spin rounded-full border-border border-t-brand`}
      />
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  )
}

export default LoadingSpinner
