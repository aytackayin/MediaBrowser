import React, { useCallback } from 'react';
import { useLanguage } from '../LanguageContext';
import type { Clip, Track } from './types';

interface TextPropertiesPanelProps {
    selectedClip: Clip | null;
    tracks: Track[];
    setTracks: (tracks: Track[] | ((prev: Track[]) => Track[])) => void;
    onCommit: (label: string) => void;
}

const FONT_FAMILIES = {
    modern: ['Inter', 'Roboto', 'Montserrat', 'Open Sans', 'Lato', 'Poppins', 'Ubuntu', 'Oswald', 'Raleway', 'Quicksand', 'Josefin Sans', 'Exo 2', 'Abel', 'Anton', 'Bebas Neue', 'Helvetica', 'Arial', 'Verdana', 'Tahoma'],
    classic: ['Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Cinzel', 'Georgia', 'Times New Roman', 'Garamond', 'Palatino'],
    script: ['Dancing Script', 'Pacifico', 'Caveat', 'Satisfy', 'Great Vibes', 'Brush Script MT'],
    display: ['Lobster', 'Righteous', 'Fredoka One', 'Permanent Marker', 'Impact', 'Luminari', 'Comic Sans MS'],
    mono: ['Fira Code', 'Roboto Mono', 'Source Code Pro', 'VT323', 'Courier New', 'Consolas'],
};

const FONT_WEIGHTS = [
    { value: '100', labelKey: 'editor.weight_thin' },
    { value: '300', labelKey: 'editor.weight_light' },
    { value: '400', labelKey: 'editor.weight_normal' },
    { value: '500', labelKey: 'editor.weight_medium' },
    { value: '600', labelKey: 'editor.weight_semibold' },
    { value: '700', labelKey: 'editor.weight_bold' },
    { value: '800', labelKey: 'editor.weight_extra_bold' },
    { value: '900', labelKey: 'editor.weight_black' },
];

const TextPropertiesPanel: React.FC<TextPropertiesPanelProps> = ({
    selectedClip, setTracks, onCommit
}) => {
    const { t } = useLanguage();

    const handleTextDataChange = useCallback((field: string, newVal: any) => {
        if (!selectedClip || !selectedClip.textData) return;
        const newTextData = { ...selectedClip.textData, [field]: newVal };

        // Auto-resize text box when font-related properties change
        const shouldResize = ['fontSize', 'text', 'fontFamily', 'fontWeight', 'letterSpacing'].includes(field);
        let newWidth = selectedClip.width;
        let newHeight = selectedClip.height;

        if (shouldResize) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const fontSize = field === 'fontSize' ? newVal : newTextData.fontSize;
                const fontFamily = field === 'fontFamily' ? newVal : (newTextData.fontFamily || 'Inter');
                const fontWeight = field === 'fontWeight' ? newVal : (newTextData.fontWeight || 'bold');
                const text = field === 'text' ? newVal : newTextData.text;
                const letterSpacing = field === 'letterSpacing' ? newVal : (newTextData.letterSpacing || 0);

                ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
                const lines = text.split('\n');
                let maxWidth = 0;
                const metrics = ctx.measureText('Mgy|ÇĞ');
                const lineHeight = (metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? fontSize * 0.8)
                    + (metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? fontSize * 0.2);
                for (const line of lines) {
                    const m = ctx.measureText(line);
                    const extraSpacing = line.length > 0 ? (line.length - 1) * letterSpacing : 0;
                    maxWidth = Math.max(maxWidth, m.width + extraSpacing);
                }
                const padding = fontSize * 0.1;
                newWidth = Math.round(maxWidth + padding * 2);
                newHeight = Math.round(lineHeight * lines.length + padding * 2);
            }
        }

        setTracks(prev => prev.map(track => ({
            ...track,
            clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, textData: newTextData, width: newWidth, height: newHeight } : c)
        })));
    }, [selectedClip, setTracks]);

    if (!selectedClip || selectedClip.type !== 'text' || !selectedClip.textData) {
        return null;
    }

    const currentFont = selectedClip.textData.fontFamily || 'Inter';
    const currentWeight = selectedClip.textData.fontWeight || 'normal';

    return (
        <div className="ve-properties-panel">
            <div className="ve-properties-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Text Content */}
                    <div className="ve-ctrl-group">
                        <label htmlFor={`text-content-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                            {t('editor.text_content') || 'Metin'}
                        </label>
                        <textarea
                            id={`text-content-${selectedClip.id}`}
                            className="ve-num-input"
                            style={{ resize: 'vertical', minHeight: '80px', lineHeight: '1.4' }}
                            value={selectedClip.textData.text}
                            onChange={e => handleTextDataChange('text', e.target.value)}
                            onBlur={() => onCommit(t('editor.edit_text') || 'Metni Düzenle')}
                            autoComplete="off"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px' }}>
                        {/* Font Size */}
                        <div className="ve-ctrl-group">
                            <label htmlFor={`font-size-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                                {t('editor.font_size') || 'Boyut'}
                            </label>
                            <input
                                id={`font-size-${selectedClip.id}`}
                                type="number"
                                className="ve-num-input"
                                value={selectedClip.textData.fontSize}
                                onChange={e => handleTextDataChange('fontSize', Number(e.target.value))}
                                onBlur={() => onCommit(t('editor.change_size') || 'Boyut Değiştir')}
                                autoComplete="off"
                            />
                        </div>

                        {/* Text Color */}
                        <div className="ve-ctrl-group">
                            <label htmlFor={`font-color-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                                {t('editor.color') || 'Renk'}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0 8px', height: '30px' }}>
                                <input
                                    id={`font-color-${selectedClip.id}`}
                                    type="color"
                                    style={{ width: '20px', height: '20px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                                    value={selectedClip.textData.color}
                                    onChange={e => handleTextDataChange('color', e.target.value)}
                                    onBlur={() => onCommit(t('editor.change_color') || 'Renk Değiştir')}
                                    autoComplete="off"
                                />
                                <span style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace' }}>
                                    {selectedClip.textData.color}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Font Family (Native Select styled like Delete Modal) */}
                    <div className="ve-ctrl-group">
                        <label htmlFor={`font-family-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                            {t('editor.font_family') || 'Font'}
                        </label>
                        <select
                            id={`font-family-${selectedClip.id}`}
                            className="ve-num-input"
                            style={{
                                appearance: 'none',
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath stroke='rgba(255,255,255,0.4)' d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 8px center',
                                backgroundSize: '14px',
                                paddingRight: '28px',
                                cursor: 'pointer',
                                colorScheme: 'dark',
                                fontFamily: currentFont
                            }}
                            value={currentFont}
                            onChange={(e) => {
                                handleTextDataChange('fontFamily', e.target.value);
                                onCommit(t('editor.change_font') || 'Font Değiştir');
                            }}
                        >
                            {Object.entries(FONT_FAMILIES).map(([groupKey, fonts]) => (
                                <optgroup key={groupKey} label={t(`editor.font_group_${groupKey}`)}>
                                    {fonts.map(font => (
                                        <option key={font} value={font} style={{ fontFamily: font, backgroundColor: '#1a1a1a', color: 'white' }}>
                                            {font}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {/* Font Weight (Native Select) */}
                        <div className="ve-ctrl-group">
                            <label htmlFor={`font-weight-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                                {t('editor.font_weight') || 'Kalınlık'}
                            </label>
                            <select
                                id={`font-weight-${selectedClip.id}`}
                                className="ve-num-input"
                                style={{
                                    appearance: 'none',
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath stroke='rgba(255,255,255,0.4)' d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 8px center',
                                    backgroundSize: '14px',
                                    paddingRight: '28px',
                                    cursor: 'pointer',
                                    colorScheme: 'dark'
                                }}
                                value={currentWeight}
                                onChange={(e) => {
                                    handleTextDataChange('fontWeight', e.target.value);
                                    onCommit(t('editor.change_weight') || 'Ağırlık Değiştir');
                                }}
                            >
                                {FONT_WEIGHTS.map(weight => (
                                    <option key={weight.value} value={weight.value} style={{ fontWeight: weight.value as any, backgroundColor: '#1a1a1a', color: 'white' }}>
                                        {t(weight.labelKey)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Letter Spacing */}
                        <div className="ve-ctrl-group">
                            <label htmlFor={`letter-spacing-${selectedClip.id}`} className="ve-ctrl-label" style={{ marginBottom: '6px' }}>
                                {t('editor.letter_spacing') || 'Harf Aralığı'}
                            </label>
                            <input
                                id={`letter-spacing-${selectedClip.id}`}
                                type="number"
                                step="0.5"
                                className="ve-num-input"
                                value={selectedClip.textData.letterSpacing || 0}
                                onChange={e => handleTextDataChange('letterSpacing', Number(e.target.value))}
                                onBlur={() => onCommit(t('editor.change_letter_spacing') || 'Harf Aralığını Değiştir')}
                                autoComplete="off"
                            />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default TextPropertiesPanel;
