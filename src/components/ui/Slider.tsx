import React, { useId } from 'react';
import { cn } from './cn';
import { fillPercent } from './sliderMath';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Unit shown after the number, for example "dB" or "ms". */
  unit?: string;
  /** Overrides the number shown (for example a signed or formatted value). */
  display?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}

export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 1, unit, display, disabled = false, onChange, className }) => {
  const id = useId();
  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-ink-dim">{label}</span>
        <span className="font-num tabular-nums text-ink">
          {display ?? value}
          {unit && <span className="ml-1 text-ink-faint">{unit}</span>}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${fillPercent(value, min, max)}%` }}
        className="ui-range w-full cursor-pointer"
      />
    </div>
  );
};
