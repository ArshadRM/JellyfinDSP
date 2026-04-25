import React from 'react'

interface TransportProps {
  isPlaying: boolean
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
  onNext: () => void
  onPrev: () => void
  disabled: boolean
}

export const Transport: React.FC<TransportProps> = ({
  isPlaying,
  onTogglePlay,
  onSeek,
  onNext,
  onPrev,
  disabled
}) => {
  return (
    <div className="transport-container">
      <button 
        className="transport-btn small" 
        onClick={onPrev} 
        disabled={disabled}
        title="Previous / Restart"
      >
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
      </button>

      <button 
        className="transport-btn medium" 
        onClick={() => onSeek(-10)} 
        disabled={disabled}
        title="Back 10s"
      >
        <span className="seek-glyph" aria-hidden="true">⏪</span>
      </button>

      <button 
        className={`transport-btn large play-pause-btn ${isPlaying ? 'playing' : ''}`}
        onClick={onTogglePlay} 
        disabled={disabled}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 19h4V5h-4v14zm-8 0h4V5H6v14z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '4px' }}><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>

      <button 
        className="transport-btn medium" 
        onClick={() => onSeek(10)} 
        disabled={disabled}
        title="Forward 10s"
      >
        <span className="seek-glyph" aria-hidden="true">⏩</span>
      </button>

      <button 
        className="transport-btn small" 
        onClick={onNext} 
        disabled={disabled}
        title="Next"
      >
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>
    </div>
  )
}
