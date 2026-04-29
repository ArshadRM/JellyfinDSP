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
  const [isFocused, setIsFocused] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const dragMode = useRef<'linear' | 'horizontal' | 'circular' | null>(null)
  const knobRef = useRef<HTMLDivElement>(null)

  // Sync internal input value with external value prop, but only when not focused
  useEffect(() => {
    if (!isFocused) {
      const displayValue = label.includes('%') ? Math.round(value * 100) : Number(value.toFixed(2))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputValue(displayValue.toString())
    }
  }, [value, isFocused, label])

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

  const quantize = (val: number) => {
    const clamped = Math.max(min, Math.min(max, val))
    if (!step) return clamped
    const stepped = Math.round(clamped / step) * step
    return parseFloat(stepped.toFixed(10))
  }

  const commitValue = (raw: string) => {
    const val = Number(raw)
    if (isNaN(val)) {
      // Revert to current value
      const displayValue = label.includes('%') ? Math.round(value * 100) : Number(value.toFixed(2))
      setInputValue(displayValue.toString())
      return
    }
    const finalVal = label.includes('%') ? val / 100 : val
    onChange(quantize(finalVal))
    // Reset local value to formatted version
    const nextVal = quantize(finalVal)
    const displayValue = label.includes('%') ? Math.round(nextVal * 100) : Number(nextVal.toFixed(2))
    setInputValue(displayValue.toString())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const multiplier = e.shiftKey ? 10 : 1
    const stepSize = step || (max - min) / 100
    
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      const nextVal = quantize(value + stepSize * multiplier)
      const displayValue = label.includes('%') ? Math.round(nextVal * 100) : Number(nextVal.toFixed(2))
      setInputValue(displayValue.toString())
      onChange(nextVal)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const nextVal = quantize(value - stepSize * multiplier)
      const displayValue = label.includes('%') ? Math.round(nextVal * 100) : Number(nextVal.toFixed(2))
      setInputValue(displayValue.toString())
      onChange(nextVal)
    } else if (e.key === 'Enter') {
      commitValue(inputValue)
      if (knobRef.current) knobRef.current.focus()
    } else if (e.key === 'Escape') {
      const displayValue = label.includes('%') ? Math.round(value * 100) : Number(value.toFixed(2))
      setInputValue(displayValue.toString())
      if (knobRef.current) knobRef.current.focus()
    }
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
        const sensitivity = 0.5 * (max - min) / 100
        const newValue = value - (deltaY * sensitivity)
        const nextVal = quantize(newValue)
        onChange(nextVal)
        prevY.current = e.clientY
      } else if (dragMode.current === 'horizontal') {
        const deltaX = e.clientX - prevX.current
        const sensitivity = 0.5 * (max - min) / 100
        const newValue = value + (deltaX * sensitivity)
        const nextVal = quantize(newValue)
        onChange(nextVal)
        prevX.current = e.clientX
      } else if (dragMode.current === 'circular') {
        const currentAngle = getCssAngle(e.clientX, e.clientY)
        let deltaAngle = currentAngle - prevAngle.current

        if (deltaAngle > 180) deltaAngle -= 360
        if (deltaAngle < -180) deltaAngle += 360

        const valueChange = (deltaAngle / ANGLE_RANGE) * (max - min)
        const nextVal = quantize(value + valueChange)
        onChange(nextVal)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, min, max, value, onChange, step, horizontalSwipe, quantize, startPos, prevX, prevY, prevAngle, center, getCssAngle, ANGLE_RANGE])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const stepSize = step || (max - min) / 100
    const change = e.deltaY > 0 ? -stepSize : stepSize
    
    const nextVal = quantize(value + change)
    const displayValue = label.includes('%') ? Math.round(nextVal * 100) : Number(nextVal.toFixed(2))
    setInputValue(displayValue.toString())
    onChange(nextVal)
  }

  const percentage = (value - min) / (max - min)
  const angle = MIN_ANGLE + (percentage * ANGLE_RANGE)
  const dashOffset = SVG_DASH_MAX - (percentage * SVG_DASH_MAX)

  useEffect(() => {
    const container = knobRef.current?.closest('.knob-container') as HTMLElement | null
    if (!container) return

    const preventScroll = (e: Event) => {
      e.preventDefault()
    }

    container.addEventListener('wheel', preventScroll, { passive: false })
    return () => container.removeEventListener('wheel', preventScroll)
  }, [])

  return (
    <div className="knob-container">
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
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onDoubleClick={onReset}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="knob-indicator"></div>
        </div>
      </div>
      <input 
        type="text" 
        className="knob-input param-input"
        value={inputValue}
        onFocus={(e) => {
          setIsFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setIsFocused(false)
          commitValue(inputValue)
        }}
        onWheel={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          setInputValue(e.target.value)
        }}
      />
    </div>
  )
}
