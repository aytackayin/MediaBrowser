import React, { useMemo } from 'react';
import { Lock, Unlock, RotateCcw, RotateCcw as RotateLeftIcon, RotateCw as RotateRightIcon, FlipHorizontal, FlipVertical } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { NumberInput } from './UIComponents';
import Tooltip from '../Tooltip';
import type { Clip } from './types';

interface TransformPanelProps {
    selectedClip: Clip | null;
    canvasSize: { w: number, h: number };
    setCanvasSize: (size: { w: number, h: number }) => void;
    isLocked: boolean;
    setIsLocked: (locked: boolean) => void;
    activeTool: 'select' | 'transform' | 'crop';
    onCommit: (label: string) => void;
    currentDims: { w: number, h: number, x: number, y: number, baseW: number, baseH: number };
    updateClipTransform: (id: number, t: any) => void;
    updateClipCrop: (id: number, c: any) => void;
    localCrop: { x: number, y: number, w: number, h: number } | null;
    setLocalCrop: (crop: { x: number, y: number, w: number, h: number } | null) => void;
}

const ASPECT_RATIOS = [
    { label: 'Free', value: 'free' },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '1:1', value: 1 / 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '21:9', value: 21 / 9 },
];

const TransformPanel: React.FC<TransformPanelProps> = ({
    selectedClip, canvasSize, setCanvasSize, isLocked, setIsLocked,
    activeTool, onCommit, currentDims, updateClipTransform,
    updateClipCrop, localCrop, setLocalCrop
}) => {
    const { t } = useLanguage();

    const activeRatio = useMemo(() => {
        if (!isLocked) return 'free';
        let ratio = 1;
        if (activeTool === 'crop' && localCrop) {
            const pxW = localCrop.w * currentDims.baseW;
            const pxH = localCrop.h * currentDims.baseH;
            if (pxH === 0) return 'free';
            ratio = pxW / pxH;
        } else {
            if (currentDims.h === 0) return 'free';
            ratio = currentDims.w / currentDims.h;
        }
        const match = ASPECT_RATIOS.find(r => typeof r.value === 'number' && Math.abs(r.value - ratio) < 0.01);
        return match ? match.value : null;
    }, [currentDims, isLocked, activeTool, localCrop]);

    const handleRatioSelect = (val: string | number) => {
        if (val === 'free') {
            setIsLocked(false);
        } else {
            setIsLocked(true);
            const ratio = val as number;
            if (activeTool === 'crop' && localCrop) {
                const baseW = currentDims.baseW || 1280;
                const baseH = currentDims.baseH || 720;
                // ratio = (W / baseW) / (H / baseH) => W/H = ratio * (baseW / baseH)
                const normalizedRatio = ratio * (baseH / baseW);

                let newW = localCrop.w;
                let newH = newW / normalizedRatio;

                if (newH > 1) {
                    newH = 1;
                    newW = newH * normalizedRatio;
                }
                if (newW > 1) {
                    newW = 1;
                    newH = newW / normalizedRatio;
                }

                // Center the crop box
                const nx = Math.max(0, Math.min(1 - newW, localCrop.x + (localCrop.w - newW) / 2));
                const ny = Math.max(0, Math.min(1 - newH, localCrop.y + (localCrop.h - newH) / 2));

                setLocalCrop({ x: nx, y: ny, w: newW, h: newH });
            } else if (selectedClip) {
                const newH = Math.round(currentDims.w / ratio);
                updateClipTransform(selectedClip.id, { scaleY: newH / currentDims.baseH });
            } else {
                setCanvasSize({ w: canvasSize.w, h: Math.round(canvasSize.w / ratio) });
            }
            onCommit(t('editor.aspect_ratio'));
        }
    };

    if (activeTool !== 'transform' && activeTool !== 'crop') return null;

    return (
        <div className={`ve-properties-panel ve-transform-panel ${activeTool === 'crop' ? 'is-crop' : ''} ${!selectedClip ? 'is-canvas' : ''}`}>
            <div className="ve-properties-body">
                {activeTool === 'transform' ? (
                    <>
                        {selectedClip && (
                            <div className="ve-transform-controls" style={{ marginBottom: '16px' }}>
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '8px', opacity: 0.7 }}>{t('editor.rotation') || 'Rotation'} & {t('editor.mirror') || 'Mirror'}</div>
                                <div className="ve-transform-buttons" style={{ display: 'flex', gap: '4px' }}>
                                    <Tooltip text={t('tooltip.rotate_left')}>
                                        <button
                                            className="ve-transform-btn"
                                            onClick={() => {
                                                const currentRot = selectedClip.transform?.rotation || 0;
                                                updateClipTransform(selectedClip.id, { rotation: (currentRot - 90) % 360 });
                                                onCommit(t('history.rotate_clip') || 'Rotate Clip');
                                            }}
                                        >
                                            <RotateLeftIcon size={16} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text={t('tooltip.rotate_right')}>
                                        <button
                                            className="ve-transform-btn"
                                            onClick={() => {
                                                const currentRot = selectedClip.transform?.rotation || 0;
                                                updateClipTransform(selectedClip.id, { rotation: (currentRot + 90) % 360 });
                                                onCommit(t('history.rotate_clip') || 'Rotate Clip');
                                            }}
                                        >
                                            <RotateRightIcon size={16} />
                                        </button>
                                    </Tooltip>
                                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                                    <Tooltip text={t('tooltip.mirror_h')}>
                                        <button
                                            className={`ve-transform-btn ${selectedClip.transform?.flipX ? 'active' : ''}`}
                                            onClick={() => {
                                                updateClipTransform(selectedClip.id, { flipX: !selectedClip.transform?.flipX });
                                                onCommit(t('history.mirror_clip') || 'Mirror Clip');
                                            }}
                                        >
                                            <FlipHorizontal size={16} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text={t('tooltip.mirror_v')}>
                                        <button
                                            className={`ve-transform-btn ${selectedClip.transform?.flipY ? 'active' : ''}`}
                                            onClick={() => {
                                                updateClipTransform(selectedClip.id, { flipY: !selectedClip.transform?.flipY });
                                                onCommit(t('history.mirror_clip') || 'Mirror Clip');
                                            }}
                                        >
                                            <FlipVertical size={16} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        )}

                        {/* X / Y Position (Show for clips) */}
                        {selectedClip && (
                            <div className="ve-transform-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div className="ve-input-group">
                                    <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.position_x')}</div>
                                    <NumberInput
                                        key={`pos-x-${selectedClip?.id}`}
                                        id="ve-pos-x"
                                        value={currentDims.x}
                                        onChange={val => updateClipTransform(selectedClip.id, { x: val })}
                                        onCommit={onCommit}
                                        commitLabel={t('editor.position_x')}
                                        className="ve-num-input"
                                    />
                                </div>
                                <div className="ve-input-group">
                                    <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.position_y')}</div>
                                    <NumberInput
                                        key={`pos-y-${selectedClip?.id}`}
                                        id="ve-pos-y"
                                        value={currentDims.y}
                                        onChange={val => updateClipTransform(selectedClip.id, { y: val })}
                                        onCommit={onCommit}
                                        commitLabel={t('editor.position_y')}
                                        className="ve-num-input"
                                    />
                                </div>
                            </div>
                        )}

                        {/* W / H Size */}
                        <div className="ve-transform-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', gap: '4px', alignItems: 'end', marginBottom: '12px' }}>
                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.width')}</div>
                                <NumberInput
                                    key={`size-w-${selectedClip?.id || 'canvas'}`}
                                    id="ve-size-w"
                                    value={currentDims.w}
                                    onChange={newW => {
                                        if (selectedClip) {
                                            const nSX = newW / currentDims.baseW;
                                            if (isLocked) {
                                                const ratio = currentDims.w / currentDims.h;
                                                const newH = Math.round(newW / ratio);
                                                updateClipTransform(selectedClip.id, { scaleX: nSX, scaleY: newH / currentDims.baseH });
                                            } else {
                                                updateClipTransform(selectedClip.id, { scaleX: nSX });
                                            }
                                        } else {
                                            if (isLocked && canvasSize.w !== 0) {
                                                const ratio = canvasSize.h / canvasSize.w;
                                                setCanvasSize({ w: newW, h: Math.round(newW * ratio) });
                                            } else {
                                                setCanvasSize({ ...canvasSize, w: newW });
                                            }
                                        }
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.width')}
                                    className="ve-num-input"
                                    lazy={isLocked}
                                />
                            </div>

                            <button
                                onClick={() => setIsLocked(!isLocked)}
                                className={`ve-lock-btn ${isLocked ? 'active' : ''}`}
                            >
                                {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>

                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.height')}</div>
                                <NumberInput
                                    key={`size-h-${selectedClip?.id || 'canvas'}`}
                                    id="ve-size-h"
                                    value={currentDims.h}
                                    onChange={newH => {
                                        if (selectedClip) {
                                            const nSY = newH / currentDims.baseH;
                                            if (isLocked) {
                                                const ratio = currentDims.w / currentDims.h;
                                                const newW = Math.round(newH * ratio);
                                                updateClipTransform(selectedClip.id, { scaleY: nSY, scaleX: newW / currentDims.baseW });
                                            } else {
                                                updateClipTransform(selectedClip.id, { scaleY: nSY });
                                            }
                                        } else {
                                            if (isLocked && canvasSize.h !== 0) {
                                                const ratio = canvasSize.w / canvasSize.h;
                                                setCanvasSize({ w: Math.round(newH * ratio), h: newH });
                                            } else {
                                                setCanvasSize({ ...canvasSize, h: newH });
                                            }
                                        }
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.height')}
                                    className="ve-num-input"
                                    lazy={isLocked}
                                />
                            </div>
                        </div>

                        {/* Aspect Ratio Presets (Only for Canvas) */}
                        {!selectedClip && (
                            <>
                                <div className="ve-panel-divider" />
                                <div className="ve-aspect-grid">
                                    {ASPECT_RATIOS.map(ratio => (
                                        <button
                                            key={ratio.label}
                                            onClick={() => handleRatioSelect(ratio.value)}
                                            className={`ve-aspect-btn ${activeRatio === ratio.value ? 'active' : ''}`}
                                        >
                                            {ratio.value === 'free' ? t('editor.free') : ratio.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    /* Crop Mode UI */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.position_x')}</div>
                                <NumberInput
                                    key={`crop-x-${selectedClip?.id}`}
                                    id="ve-crop-x"
                                    value={Math.round((localCrop?.x || 0) * currentDims.baseW)}
                                    onChange={val => {
                                        const baseW = currentDims.baseW || 1;
                                        const clampedX = Math.max(0, Math.min(baseW * (1 - (localCrop?.w || 0)), val));
                                        setLocalCrop({ ...localCrop || { x: 0, y: 0, w: 1, h: 1 }, x: clampedX / baseW });
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.position_x')}
                                    className="ve-num-input"
                                />
                            </div>
                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.position_y')}</div>
                                <NumberInput
                                    key={`crop-y-${selectedClip?.id}`}
                                    id="ve-crop-y"
                                    value={Math.round((localCrop?.y || 0) * currentDims.baseH)}
                                    onChange={val => {
                                        const baseH = currentDims.baseH || 1;
                                        const clampedY = Math.max(0, Math.min(baseH * (1 - (localCrop?.h || 0)), val));
                                        setLocalCrop({ ...localCrop || { x: 0, y: 0, w: 1, h: 1 }, y: clampedY / baseH });
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.position_y')}
                                    className="ve-num-input"
                                />
                            </div>
                        </div>

                        <div className="ve-transform-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', gap: '4px', alignItems: 'end' }}>
                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.width')}</div>
                                <NumberInput
                                    key={`crop-w-${selectedClip?.id}`}
                                    id="ve-crop-w"
                                    value={Math.round((localCrop?.w || 1) * currentDims.baseW)}
                                    onChange={newPxW => {
                                        const baseW = currentDims.baseW || 1;
                                        const baseH = currentDims.baseH || 1;
                                        const newW = Math.max(1, Math.min(baseW, newPxW)) / baseW;

                                        if (isLocked) {
                                            const currentPxW = (localCrop?.w || 1) * baseW;
                                            const currentPxH = (localCrop?.h || 1) * baseH;
                                            const ratio = currentPxW / (currentPxH || 1);

                                            // Calculate target width AND height
                                            let targetW = newW;
                                            let targetH = (targetW * baseW / ratio) / baseH;

                                            // If height exceeds 100%, shrink both
                                            if (targetH > 1) {
                                                targetH = 1;
                                                targetW = (targetH * baseH * ratio) / baseW;
                                            }

                                            const dx = ((localCrop?.w || 1) - targetW) / 2;
                                            const dy = ((localCrop?.h || 1) - targetH) / 2;
                                            const newX = Math.max(0, Math.min(1 - targetW, (localCrop?.x || 0) + dx));
                                            const newY = Math.max(0, Math.min(1 - targetH, (localCrop?.y || 0) + dy));

                                            setLocalCrop({
                                                ...localCrop || { x: 0, y: 0, w: 1, h: 1 },
                                                w: targetW,
                                                h: targetH,
                                                x: newX,
                                                y: newY
                                            });
                                        } else {
                                            const dx = ((localCrop?.w || 1) - newW) / 2;
                                            const newX = Math.max(0, Math.min(1 - newW, (localCrop?.x || 0) + dx));
                                            setLocalCrop({
                                                ...localCrop || { x: 0, y: 0, w: 1, h: 1 },
                                                w: newW,
                                                x: newX
                                            });
                                        }
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.width')}
                                    className="ve-num-input"
                                    lazy={isLocked}
                                />
                            </div>

                            <button
                                onClick={() => setIsLocked(!isLocked)}
                                className={`ve-lock-btn ${isLocked ? 'active' : ''}`}
                            >
                                {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>

                            <div className="ve-input-group">
                                <div className="ve-ctrl-label" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>{t('editor.height')}</div>
                                <NumberInput
                                    key={`crop-h-${selectedClip?.id}`}
                                    id="ve-crop-h"
                                    value={Math.round((localCrop?.h || 1) * currentDims.baseH)}
                                    onChange={newPxH => {
                                        const baseW = currentDims.baseW || 1;
                                        const baseH = currentDims.baseH || 1;
                                        const newH = Math.max(1, Math.min(baseH, newPxH)) / baseH;

                                        if (isLocked) {
                                            const currentPxW = (localCrop?.w || 1) * baseW;
                                            const currentPxH = (localCrop?.h || 1) * baseH;
                                            const ratio = currentPxW / (currentPxH || 1);

                                            // Calculate target width AND height
                                            let targetH = newH;
                                            let targetW = (targetH * baseH * ratio) / baseW;

                                            // If width exceeds 100%, shrink both
                                            if (targetW > 1) {
                                                targetW = 1;
                                                targetH = (targetW * baseW / ratio) / baseH;
                                            }

                                            const dx = ((localCrop?.w || 1) - targetW) / 2;
                                            const dy = ((localCrop?.h || 1) - targetH) / 2;
                                            const newX = Math.max(0, Math.min(1 - targetW, (localCrop?.x || 0) + dx));
                                            const newY = Math.max(0, Math.min(1 - targetH, (localCrop?.y || 0) + dy));

                                            setLocalCrop({
                                                ...localCrop || { x: 0, y: 0, w: 1, h: 1 },
                                                w: targetW,
                                                h: targetH,
                                                x: newX,
                                                y: newY
                                            });
                                        } else {
                                            const dy = ((localCrop?.h || 1) - newH) / 2;
                                            const newY = Math.max(0, Math.min(1 - newH, (localCrop?.y || 0) + dy));
                                            setLocalCrop({
                                                ...localCrop || { x: 0, y: 0, w: 1, h: 1 },
                                                h: newH,
                                                y: newY
                                            });
                                        }
                                    }}
                                    onCommit={onCommit}
                                    commitLabel={t('editor.height')}
                                    className="ve-num-input"
                                    lazy={isLocked}
                                />
                            </div>
                        </div>

                        <div className="ve-panel-divider" style={{ margin: '8px 0' }} />
                        <div className="ve-aspect-grid">
                            {ASPECT_RATIOS.map(ratio => (
                                <button
                                    key={ratio.label}
                                    onClick={() => handleRatioSelect(ratio.value)}
                                    className={`ve-aspect-btn ${activeRatio === ratio.value ? 'active' : ''}`}
                                >
                                    {ratio.value === 'free' ? t('editor.free') : ratio.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="ve-panel-divider" />
                <div className="ve-reset-section">
                    <button
                        className="ve-reset-btn"
                        onClick={() => {
                            if (activeTool === 'crop' && selectedClip) {
                                setLocalCrop({ x: 0, y: 0, w: 1, h: 1 });
                                updateClipCrop(selectedClip.id, { x: 0, y: 0, w: 1, h: 1 });
                            } else if (selectedClip) {
                                updateClipTransform(selectedClip.id, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false });
                                onCommit(t('editor.reset_transform') || 'Reset Transform');
                            } else {
                                setCanvasSize({ w: 1920, h: 1080 });
                            }
                        }}
                    >
                        <RotateCcw size={14} />
                        {activeTool === 'crop' ? t('editor.reset_crop') || 'Reset Crop' : (selectedClip ? t('editor.reset_clip_transform') || 'Reset Transform' : t('editor.reset_canvas') || 'Reset Canvas')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TransformPanel;
