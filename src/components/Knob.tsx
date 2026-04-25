import { useEffect, useRef, useState } from 'react'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (val: number) => void
  onReset?: () => void
  horizontalSwipe?: boolean
}

export function Knob({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
  horizontalSwipe = true,
}: KnobProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragMode = useRef<'linear' | 'horizontal' | 'circular' | null>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  
  const startPos = useRef({ x: 0, y: 0 })
  const prevX = useRef(0)
  const prevY = useRef(0)
  const prevAngle = useRef(0)
  const center = useRef({ x: 0, y: 0 })

  const MIN_ANGLE = -135
  const MAX_ANGLE = 135
  const ANGLE_RANGE = MAX_ANGLE - MIN_ANGLE
  const SVG_DASH_MAX = 188.5

  const getCssAngle = (x: number, y: number) => {
    const radians = Math.atan2(y - center.current.y, x - center.current.x)
    let degrees = radians * (180 / Math.PI)
    degrees += 90
    if (degrees > 180) degrees -= 360
    if (degrees < -180) degrees += 360
    return degrees
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragMode.current = null

    if (knobRef.current) {
      const rect = knobRef.current.getBoundingClientRect()
      center.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      }
    }

    startPos.current = { x: e.clientX, y: e.clientY }
    prevX.current = e.clientX
    prevY.current = e.clientY
    prevAngle.current = getCssAngle(e.clientX, e.clientY)
  }

  useEffect(() => {
    if (!isDragging) return

    const onPointerMove = (e: PointerEvent) => {
      if (dragMode.current === null) {
        const deltaXTotal = Math.abs(e.clientX - startPos.current.x)
        const deltaYTotal = Math.abs(e.clientY - startPos.current.y)
        
        if (deltaXTotal > 3 || deltaYTotal > 3) {
          if (horizontalSwipe && deltaXTotal > deltaYTotal * 1.3) {
            dragMode.current = 'horizontal'
          } else if (deltaYTotal > deltaXTotal * 2) {
            dragMode.current = 'linear'
          } else {
            dragMode.current = 'circular'
          }
        } else {
          return
        }
      }

      if (dragMode.current === 'linear') {
        const deltaY = e.clientY - prevY.current
        const sensitivity = 0.5 * (max - min) / 100 // Scale sensitivity to range
        const newValue = value - (deltaY * sensitivity)
        onChange(Math.max(min, Math.min(max, newValue)))
        prevY.current = e.clientY
      } else if (dragMode.current === 'horizontal') {
        const deltaX = e.clientX - prevX.current
        const sensitivity = 0.5 * (max - min) / 100
        const newValue = value + (deltaX * sensitivity)
        onChange(Math.max(min, Math.min(max, newValue)))
        prevX.current = e.clientX
      } else if (dragMode.current === 'circular') {
        const currentAngle = getCssAngle(e.clientX, e.clientY)
        let deltaAngle = currentAngle - prevAngle.current

        if (deltaAngle > 180) deltaAngle -= 360
        if (deltaAngle < -180) deltaAngle += 360

        const valueChange = (deltaAngle / ANGLE_RANGE) * (max - min)
        onChange(Math.max(min, Math.min(max, value + valueChange)))
        prevAngle.current = currentAngle
      }
    }

    const onPointerUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)

    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [isDragging, min, max, value, onChange])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Sensitivity tuning: adjust based on step or total range
    const stepSize = step || (max - min) / 100
    const change = e.deltaY > 0 ? -stepSize : stepSize
    
    onChange(Math.max(min, Math.min(max, value + change * 2)))
  }

  const percentage = (value - min) / (max - min)
  const angle = MIN_ANGLE + (percentage * ANGLE_RANGE)
  const dashOffset = SVG_DASH_MAX - (percentage * SVG_DASH_MAX)

  return (
    <div
      className="knob-container"
      onWheel={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <span className="knob-label">{label}</span>
      <div className="knob-wrapper">
        <svg className="knob-ring" viewBox="0 0 100 100">
          <circle className="ring-bg" cx="50" cy="50" r="40"></circle>
          <circle 
            className="ring-value" 
            cx="50" 
            cy="50" 
            r="40" 
            style={{ strokeDashoffset: dashOffset }}
          ></circle>
        </svg>
        <div 
          className="knob" 
          ref={knobRef}
          onPointerDown={handlePointerDown}
          onDoubleClick={onReset}
          onWheel={handleWheel}
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="knob-indicator"></div>
        </div>
      </div>
      <input 
        type="number" 
        className="knob-input param-input" 
        step="any"
        value={label.includes('%') ? Math.round(value * 100) : Number(value.toFixed(2))} 
        onWheel={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onChange={(e) => {
          const val = Number(e.target.value)
          onChange(label.includes('%') ? val / 100 : val)
        }}
      />
    </div>
  )
}
