import React from 'react';

interface ControlSliderProps {
    id?: string;
    label: string;
    icon?: any;
    value: number;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (val: number) => void;
    onCommit?: (label: string) => void;
}

export const ControlSlider: React.FC<ControlSliderProps> = React.memo(({ id, label, icon: Icon, value, min, max, step, defaultValue, onChange, onCommit }) => {
    const [localValue, setLocalValue] = React.useState(value.toFixed(2));
    const inputRef = React.useRef<HTMLInputElement>(null);
    const startValRef = React.useRef<number>(value);
    const focusValRef = React.useRef<number>(value);
    const isDragging = React.useRef(false);

    const handleDoubleClick = () => {
        if (value !== defaultValue) {
            onChange(defaultValue);
            setLocalValue(defaultValue.toFixed(2));
            if (onCommit) onCommit(`${label} (Reset)`);
        }
    };

    const fieldId = React.useMemo(() => id || `ve-slider-${label.toLowerCase().replace(/[\s\/]+/g, '-')}`, [id, label]);

    React.useEffect(() => {
        setLocalValue(value.toFixed(2));
    }, [value]);

    React.useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (document.activeElement !== input) return;
            const delta = e.deltaY > 0 ? -step : step;
            const newVal = Math.min(Math.max(value + delta, min), max);
            onChange(newVal);
            setLocalValue(newVal.toFixed(2));
        };
        input.addEventListener('wheel', handleWheel, { passive: false });
        return () => input.removeEventListener('wheel', handleWheel);
    }, [value, onChange, step, min, max]);

    const handleInputCommit = () => {
        let parsed = parseFloat(localValue);
        if (isNaN(parsed)) parsed = value;
        parsed = Math.min(Math.max(parsed, min), max);
        onChange(parsed);
        setLocalValue(parsed.toFixed(2));
        if (parsed !== focusValRef.current && onCommit) {
            onCommit(label);
        }
    };

    return (
        <div className="ve-ctrl-group is-slider">
            <div className="ve-ctrl-header">
                <div className="ve-ctrl-label-container">
                    {Icon && <Icon size={12} className="ve-ctrl-icon" />}
                    <label htmlFor={fieldId} className="ve-ctrl-label">{label}</label>
                </div>
                <input
                    id={fieldId}
                    name={fieldId}
                    ref={inputRef}
                    className="ve-ctrl-input"
                    type="text"
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onFocus={() => {
                        focusValRef.current = value;
                    }}
                    onBlur={handleInputCommit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleInputCommit();
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                />
            </div>
            <input
                id={`${fieldId}-range`}
                name={`${fieldId}-range`}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onPointerDown={(e) => {
                    const target = e.target as HTMLInputElement;
                    target.setPointerCapture(e.pointerId);
                    startValRef.current = value;
                    isDragging.current = true;
                }}
                onChange={e => onChange(parseFloat(e.target.value))}
                onPointerUp={(e) => {
                    if (!isDragging.current) return;
                    isDragging.current = false;
                    const target = e.target as HTMLInputElement;
                    if (target.hasPointerCapture(e.pointerId)) {
                        target.releasePointerCapture(e.pointerId);
                    }
                    const currentVal = parseFloat(target.value);
                    if (currentVal !== startValRef.current && onCommit) {
                        onCommit(label);
                    }
                }}
                onDoubleClick={handleDoubleClick}
                className="ve-ctrl-slider"
            />
        </div>
    );
});
