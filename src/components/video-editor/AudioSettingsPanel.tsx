import React, { useCallback } from 'react';
import { Volume2, Sliders } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { ControlSlider } from './ControlSlider';
import type { Track, Clip } from './types';

interface AudioSettingsPanelProps {
    selectedClip: Clip | null;
    tracks: Track[];
    setTracks: (tracks: Track[] | ((prev: Track[]) => Track[])) => void;
    onCommit: (label: string) => void;
}

export const AudioSettingsPanel: React.FC<AudioSettingsPanelProps> = ({
    selectedClip, setTracks, onCommit
}) => {
    const { t } = useLanguage();

    const handleClipPropertyChange = useCallback((field: string, newVal: number) => {
        if (!selectedClip) return;
        setTracks(prev => prev.map(track => ({
            ...track,
            clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, [field]: newVal } : c)
        })));
    }, [selectedClip, setTracks]);

    if (!selectedClip) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {t('editor.select_clip_to_adjust') || 'Please select a clip to adjust settings.'}
            </div>
        );
    }

    return (
        <div className="ve-properties-panel">
            <div className="ve-properties-body">
                <ControlSlider
                    icon={Volume2}
                    label={t('video.volume') || 'Ses Düzeyi'}
                    value={selectedClip.volume ?? 1}
                    defaultValue={1}
                    onChange={v => handleClipPropertyChange('volume', v)}
                    min={0} max={1.0} step={0.01}
                    onCommit={onCommit}
                />
                <ControlSlider
                    icon={Sliders}
                    label={t('video.fade_in') || 'Başlangıç Fade (sn)'}
                    value={selectedClip.fadeIn ?? 0}
                    defaultValue={0}
                    onChange={v => handleClipPropertyChange('fadeIn', v)}
                    min={0} max={10.0} step={0.1}
                    onCommit={onCommit}
                />
                <ControlSlider
                    icon={Sliders}
                    label={t('video.fade_out') || 'Bitiş Fade (sn)'}
                    value={selectedClip.fadeOut ?? 0}
                    defaultValue={0}
                    onChange={v => handleClipPropertyChange('fadeOut', v)}
                    min={0} max={10.0} step={0.1}
                    onCommit={onCommit}
                />
            </div>
        </div>
    );
};

export default AudioSettingsPanel;
