import React from 'react';

// Number Input Component
interface NumberInputProps {
    id?: string;
    value: number;
    onChange: (val: number) => void;
    onCommit?: (label: string) => void;
    commitLabel?: string;
    className?: string;
    lazy?: boolean;
}

export const NumberInput: React.FC<NumberInputProps> = React.memo(({ id, value, onChange, onCommit, commitLabel, className, lazy }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [localVal, setLocalVal] = React.useState(String(value));
    const focusValRef = React.useRef<number>(value);

    React.useEffect(() => {
        setLocalVal(String(value));
    }, [value]);

    // Wheel handler
    React.useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (document.activeElement !== input) return;
            const step = e.shiftKey ? 10 : 1;
            const delta = e.deltaY > 0 ? -step : step;
            const newVal = parseInt(input.value) + delta;
            onChange(newVal);
            setLocalVal(String(newVal));
        };
        input.addEventListener('wheel', handleWheel, { passive: false });
        return () => input.removeEventListener('wheel', handleWheel);
    }, [onChange]);

    const commitChanges = () => {
        const parsed = parseInt(localVal);
        const finalVal = isNaN(parsed) ? value : parsed;

        if (lazy) {
            onChange(finalVal);
        }

        if (finalVal !== focusValRef.current && onCommit && commitLabel) {
            onCommit(commitLabel);
        }
    };

    return (
        <input
            id={id}
            name={id}
            ref={inputRef}
            type="number"
            value={localVal}
            onFocus={() => {
                focusValRef.current = value;
            }}
            onChange={(e) => {
                setLocalVal(e.target.value);
                if (!lazy) {
                    const parsed = parseInt(e.target.value);
                    if (!isNaN(parsed)) onChange(parsed);
                }
            }}
            onBlur={commitChanges}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                }
            }}
            className={className}
        />
    );
});
