import React, { useCallback, useEffect, useRef } from "react";

interface RangeSliderProps {
  min: number;
  max: number;
  minVal: number;
  maxVal: number;
  onChange: (vals: { min: number; max: number }) => void;
  label: string;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  minVal,
  maxVal,
  onChange,
  label,
}) => {
  const minValRef = useRef(minVal);
  const maxValRef = useRef(maxVal);
  const range = useRef<HTMLDivElement>(null);

  // Convert to percentage
  const getPercent = useCallback(
    (value: number) => Math.round(((value - min) / (max - min)) * 100),
    [min, max]
  );

  // Set width of the range to decrease from the left side
  useEffect(() => {
    const minPercent = getPercent(minVal);
    const maxPercent = getPercent(maxValRef.current);

    if (range.current) {
      range.current.style.left = `${minPercent}%`;
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [minVal, getPercent]);

  // Set width of the range to decrease from the right side
  useEffect(() => {
    const minPercent = getPercent(minValRef.current);
    const maxPercent = getPercent(maxVal);

    if (range.current) {
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [maxVal, getPercent]);

  return (
    <div className="range-slider-container">
      <div className="range-slider-header">
        <span className="range-slider-label">{label}</span>
        <div className="range-slider-values">
          <input
            type="number"
            className="param-input"
            min={min}
            max={max}
            value={Math.round(minVal)}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const value = Math.max(min, Math.min(maxVal - 1, raw))
              onChange({ min: value, max: maxVal })
              minValRef.current = value
            }}
          />
          <span className="range-separator">—</span>
          <input
            type="number"
            className="param-input"
            min={min}
            max={max}
            value={Math.round(maxVal)}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const value = Math.min(max, Math.max(minVal + 1, raw))
              onChange({ min: minVal, max: value })
              maxValRef.current = value
            }}
          />
        </div>
      </div>

      <div className="range-slider-wrap">
        <input
          type="range"
          min={min}
          max={max}
          value={minVal}
          onChange={(event) => {
            const value = Math.min(Number(event.target.value), maxVal - 1);
            onChange({ min: value, max: maxVal });
            minValRef.current = value;
          }}
          className="thumb thumb--left"
          style={{ zIndex: minVal > max - 100 ? "5" : undefined }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={maxVal}
          onChange={(event) => {
            const value = Math.max(Number(event.target.value), minVal + 1);
            onChange({ min: minVal, max: value });
            maxValRef.current = value;
          }}
          className="thumb thumb--right"
        />

        <div className="slider">
          <div className="slider__track" />
          <div ref={range} className="slider__range" />
        </div>
      </div>
    </div>
  );
};
