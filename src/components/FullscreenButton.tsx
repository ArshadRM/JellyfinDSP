import React from 'react'

interface FullscreenButtonProps {
  isActive: boolean
  onToggle: () => void
  className?: string
}

export const FullscreenButton: React.FC<FullscreenButtonProps> = ({
  isActive,
  onToggle,
  className = '',
}) => {
  return (
    <button
      type="button"
      className={`ghost fullscreen-icon-btn ${className}`.trim()}
      onClick={onToggle}
      title={isActive ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-label={isActive ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {isActive ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 3 3 3 3 9" />
          <line x1="3" y1="3" x2="10" y2="10" />
          <polyline points="15 21 21 21 21 15" />
          <line x1="14" y1="14" x2="21" y2="21" />
          <polyline points="21 9 21 3 15 3" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <polyline points="3 15 3 21 9 21" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <polyline points="21 15 21 21 15 21" />
          <polyline points="3 9 3 3 9 3" />
        </svg>
      )}
    </button>
  )
}
