import React, { useCallback } from 'react';
import { Sun, Contrast, Droplets, Palette, Maximize, Sliders, Image, RefreshCcw } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import type { VideoSettings, Track, Clip } from './types';
import { DEFAULT_SETTINGS } from './types';
import { ControlSlider } from './ControlSlider';

interface PropertiesProps {
    settings: VideoSettings;
    setSettings: React.Dispatch<React.SetStateAction<VideoSettings>>;
    selectedClip: Clip | null;
    tracks: Track[];
    setTracks: (tracks: Track[] | ((prev: Track[]) => Track[])) => void;
    onCommit: (label: string) => void;
}

const Properties: React.FC<PropertiesProps> = ({
    settings, setSettings, selectedClip, setTracks, onCommit
}) => {
    const { t } = useLanguage();

    const getSettingValue = useCallback((field: string) => {
        if (selectedClip && selectedClip.settings) {
            return (selectedClip.settings as any)[field];
        }
        return (settings as any)[field];
    }, [selectedClip, settings]);

    const handleSettingChange = useCallback((field: string, newVal: number) => {
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

    return (
        <div className="ve-properties-panel">
            <div className="ve-properties-body">
                {selectedClip ? (
                    <>
                        <ControlSlider icon={Sun} label={t('editor.brightness')} value={getSettingValue('brightness')} defaultValue={DEFAULT_SETTINGS.brightness} onChange={v => handleSettingChange('brightness', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Contrast} label={t('editor.contrast')} value={getSettingValue('contrast')} defaultValue={DEFAULT_SETTINGS.contrast} onChange={v => handleSettingChange('contrast', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Sliders} label={t('editor.gamma')} value={getSettingValue('gamma')} defaultValue={DEFAULT_SETTINGS.gamma} onChange={v => handleSettingChange('gamma', v)} min={-2} max={2} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Droplets} label={t('editor.saturation')} value={getSettingValue('saturation')} defaultValue={DEFAULT_SETTINGS.saturation} onChange={v => handleSettingChange('saturation', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Sun} label={t('editor.exposure')} value={getSettingValue('exposure')} defaultValue={DEFAULT_SETTINGS.exposure} onChange={v => handleSettingChange('exposure', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Palette} label={t('editor.temp')} value={getSettingValue('temp')} defaultValue={DEFAULT_SETTINGS.temp} onChange={v => handleSettingChange('temp', v)} min={-1.5} max={1.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Palette} label={t('editor.tint')} value={getSettingValue('tint')} defaultValue={DEFAULT_SETTINGS.tint} onChange={v => handleSettingChange('tint', v)} min={-1.5} max={1.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Droplets} label={t('editor.vibrance')} value={getSettingValue('vibrance')} defaultValue={DEFAULT_SETTINGS.vibrance} onChange={v => handleSettingChange('vibrance', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Palette} label={t('editor.sepia')} value={getSettingValue('sepia')} defaultValue={DEFAULT_SETTINGS.sepia} onChange={v => handleSettingChange('sepia', v)} min={0} max={1} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Palette} label={t('editor.hue')} value={getSettingValue('hue')} defaultValue={DEFAULT_SETTINGS.hue} onChange={v => handleSettingChange('hue', v)} min={-1} max={1} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Contrast} label={t('editor.clarity')} value={getSettingValue('clarity')} defaultValue={DEFAULT_SETTINGS.clarity} onChange={v => handleSettingChange('clarity', v)} min={-2.5} max={2.5} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Image} label={t('editor.dehaze')} value={getSettingValue('dehaze')} defaultValue={DEFAULT_SETTINGS.dehaze} onChange={v => handleSettingChange('dehaze', v)} min={-1} max={1} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Droplets} label={t('editor.opacity')} value={getSettingValue('opacity')} defaultValue={DEFAULT_SETTINGS.opacity} onChange={v => handleSettingChange('opacity', v)} min={0} max={1} step={0.01} onCommit={onCommit} />
                        <ControlSlider icon={Maximize} label={t('editor.blur')} value={getSettingValue('blur')} defaultValue={DEFAULT_SETTINGS.blur} onChange={v => handleSettingChange('blur', v)} min={0} max={50} step={0.1} onCommit={onCommit} />
                        <ControlSlider icon={Maximize} label={t('editor.vignette')} value={getSettingValue('vignette')} defaultValue={DEFAULT_SETTINGS.vignette} onChange={v => handleSettingChange('vignette', v)} min={0} max={2.0} step={0.01} onCommit={onCommit} />
                        <ControlSlider
                            icon={Sliders}
                            label={t('editor.speed') || 'Hız'}
                            value={selectedClip.speed || 1}
                            defaultValue={1}
                            onChange={v => {
                                const oldSpeed = selectedClip.speed || 1;
                                const newDuration = (selectedClip.duration * oldSpeed) / v;
                                setTracks(prev => prev.map(track => ({
                                    ...track,
                                    clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, speed: v, duration: newDuration } : c)
                                })));
                            }}
                            min={0.1}
                            max={10.0}
                            step={0.1}
                            onCommit={onCommit}
                        />

                        <div className="ve-panel-divider" />
                        <div className="ve-reset-section">
                            <button
                                className="ve-reset-btn"
                                onClick={() => {
                                    setTracks(prev => prev.map(track => ({
                                        ...track,
                                        clips: track.clips.map(c => c.id === selectedClip.id ? { ...c, settings: DEFAULT_SETTINGS } : c)
                                    })));
                                    onCommit(t('editor.reset_clip') || 'Reset Clip');
                                }}
                            >
                                <RefreshCcw size={14} />
                                {t('editor.reset_clip') || 'Reset Clip'}
                            </button>
                        </div>
                    </>
                ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {t('editor.select_clip_to_adjust') || 'Please select a clip to adjust settings.'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Properties;
