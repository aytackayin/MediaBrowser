import React from 'react';
import { RefreshCcw } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import type { VideoSettings, Track, Clip } from './types';
import { DEFAULT_SETTINGS } from './types';
import { ControlSlider } from './ControlSlider';

interface ColorBalancePanelProps {
    settings: VideoSettings;
    setSettings: React.Dispatch<React.SetStateAction<VideoSettings>>;
    selectedClip: Clip | null;
    tracks: Track[];
    setTracks: (tracks: Track[] | ((prev: Track[]) => Track[])) => void;
    onCommit: (label: string) => void;
}

const ColorBalancePanel: React.FC<ColorBalancePanelProps> = ({
    settings, setSettings, selectedClip, setTracks, onCommit
}) => {
    const { t } = useLanguage();

    const getSettingValue = React.useCallback((field: string) => {
        if (selectedClip && selectedClip.settings) {
            return (selectedClip.settings as any)[field];
        }
        return (settings as any)[field];
    }, [selectedClip, settings]);

    const handleSettingChange = React.useCallback((field: string, newVal: number) => {
        if (selectedClip) {
            const newClipSettings = { ...(selectedClip.settings || settings), [field]: newVal };
            setTracks(prev => prev.map(track => ({
                ...track,
                clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, settings: newClipSettings } : c)
            })));
        } else {
            setSettings(prev => ({ ...prev, [field]: newVal }));
        }
    }, [selectedClip, settings, setTracks, setSettings]);

    const resetColorBalance = () => {
        const fields = ['shR', 'shG', 'shB', 'midR', 'midG', 'midB', 'hiR', 'hiG', 'hiB'];
        if (selectedClip) {
            const newClipSettings = { ...(selectedClip.settings || settings) };
            fields.forEach(f => (newClipSettings as any)[f] = (DEFAULT_SETTINGS as any)[f]);
            setTracks(prev => prev.map(track => ({
                ...track,
                clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, settings: newClipSettings } : c)
            })));
        } else {
            setSettings(prev => {
                const next = { ...prev };
                fields.forEach(f => (next as any)[f] = (DEFAULT_SETTINGS as any)[f]);
                return next;
            });
        }
        onCommit(t('editor.reset_color_balance') || 'Reset Color Balance');
    };

    return (
        <div className="ve-properties-panel">
            <div className="ve-properties-body">
                {[
                    { title: t('editor.shadows'), fields: ['shR', 'shG', 'shB'] },
                    { title: t('editor.midtones'), fields: ['midR', 'midG', 'midB'] },
                    { title: t('editor.highlights'), fields: ['hiR', 'hiG', 'hiB'] },
                ].map(group => (
                    <div key={group.title}>
                        <div className="ve-color-bal-group-title">{group.title}</div>
                        {group.fields.map(field => (
                            <ControlSlider
                                key={field}
                                id={`cb-${field}`}
                                label={field.endsWith('R') ? t('editor.red') : (field.endsWith('G') ? t('editor.green') : t('editor.blue'))}
                                value={getSettingValue(field)}
                                defaultValue={(DEFAULT_SETTINGS as any)[field]}
                                onChange={(v: number) => handleSettingChange(field, v)}
                                min={-0.5} max={0.5} step={0.01}
                                onCommit={onCommit}
                            />
                        ))}
                    </div>
                ))}

                <div className="ve-panel-divider" />
                <div className="ve-reset-section">
                    <button
                        className="ve-reset-btn"
                        onClick={resetColorBalance}
                    >
                        <RefreshCcw size={14} />
                        {t('editor.reset_color_balance') || 'Reset Color Balance'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ColorBalancePanel;
