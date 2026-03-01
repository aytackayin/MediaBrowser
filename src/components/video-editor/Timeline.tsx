import React, { useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import {
    Scissors, Trash2, ZoomIn, ZoomOut,
    Music, Video as VideoIcon, Plus, Type, ArrowLeftToLine
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useLanguage } from '../LanguageContext';
import Tooltip from '../Tooltip';
import type { Track, Clip } from './types';
import { thumbnailGenerator } from '../../utils/ThumbnailGenerator';
import { waveformGenerator } from '../../utils/WaveformGenerator';

// ─── Visual Helper ───
const ClipVisual: React.FC<{ clip: Clip; zoom: number; type: 'video' | 'audio' }> = ({ clip, zoom, type }) => {
    const [visuals, setVisuals] = React.useState<string[]>([]);
    const thumbWidth = 100; // Optimal balance for performance and detail
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let isMounted = true;
        const loadVisuals = async () => {
            setVisuals([]); // Clear old visuals on change
            const isImage = clip.path.match(/\.(png|jpg|jpeg|gif|tif|tiff|bmp|webp|svg)$/i);

            if (isImage) {
                if (clip.base64_image) {
                    setVisuals([clip.base64_image]);
                } else {
                    setVisuals([convertFileSrc(clip.path) + (clip.mtime ? `?t=${clip.mtime}` : '')]);
                }
                return;
            }

            if (type === 'video') {
                const count = Math.ceil((clip.duration * zoom) / thumbWidth);
                const urls: string[] = [];
                // Allow more thumbnails if it's very long, but queue handles it
                for (let i = 0; i < count; i++) {
                    if (!isMounted) break;
                    // Request frame from the center of the thumbnail for better visual sync
                    const time = clip.sourceStart + (((i + 0.5) * thumbWidth) / zoom) * (clip.speed || 1);
                    const url = await thumbnailGenerator.getThumbnail(clip.path, time, clip.mtime);
                    if (url && isMounted) {
                        urls.push(url);
                        // Batch updates: every 10 thumbnails or at the end
                        if (i % 10 === 0 || i === count - 1) {
                            setVisuals([...urls]);
                        }
                    }
                }
            } else if (type === 'audio') {
                const pixelWidth = clip.duration * zoom;
                const roundedPixelWidth = Math.ceil(pixelWidth / 10) * 10;
                const url = await waveformGenerator.getWaveformImage(
                    clip.path,
                    clip.sourceStart,
                    clip.duration * (clip.speed || 1), // Use source duration for waveform
                    roundedPixelWidth,
                    clip.mtime
                );
                if (url && isMounted) setVisuals([url]);
            }
        };
        loadVisuals();
        return () => { isMounted = false; };
    }, [clip.path, clip.duration, clip.sourceStart, clip.speed, zoom, type, clip.base64_image, clip.mtime]);

    return (
        <div ref={containerRef} className="ve-clip-visual-container">
            {visuals.length > 0 ? (
                visuals.map((src, i) => (
                    <img
                        key={i}
                        src={src}
                        alt=""
                        className={type === 'audio' ? "ve-clip-waveform-img" : "ve-clip-thumb"}
                        style={{
                            flex: type === 'video' ? `0 0 ${thumbWidth}px` : '1 1 100%',
                            width: type === 'video' ? `${thumbWidth}px` : '100%',
                            height: '100%',
                            objectFit: type === 'audio' ? 'fill' : 'cover'
                        }}
                    />
                ))
            ) : null}
        </div>
    );
};

// ─── Props ───
interface TimelineProps {
    tracks: Track[];
    setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
    zoom: number;
    setZoom: React.Dispatch<React.SetStateAction<number>>;
    currentTime: number;
    duration: number;
    selectedClipId: number | null;
    setSelectedClipId: (id: number | null) => void;
    splitSelectedClip: () => void;
    deleteSelectedClip: () => void;
    setCurrentTime: (time: number) => void;
    galleryRoot?: string;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCommit: (label?: string, overrideTracks?: Track[]) => void;
}

// ─── Component ───
const Timeline: React.FC<TimelineProps> = ({
    tracks, setTracks, zoom, setZoom,
    currentTime, duration, selectedClipId, setSelectedClipId,
    splitSelectedClip, deleteSelectedClip, setCurrentTime,
    galleryRoot, onCommit
}) => {
    const { t } = useLanguage();
    const timelineRef = useRef<HTMLDivElement>(null);
    const trackLabelsRef = useRef<HTMLDivElement>(null);
    const lastZoomPoint = useRef<{ time: number | null; x: number }>({ time: null, x: 0 });

    const latestTracksRef = useRef(tracks);
    useEffect(() => {
        latestTracksRef.current = tracks;
    }, [tracks]);

    // === Sync Vertical Scroll ===
    useEffect(() => {
        const timelineEl = timelineRef.current;
        const labelsEl = trackLabelsRef.current;
        if (!timelineEl || !labelsEl) return;
        const syncScroll = (src: HTMLDivElement, dst: HTMLDivElement) => dst.scrollTop = src.scrollTop;
        const h1 = () => syncScroll(timelineEl, labelsEl);
        const h2 = () => syncScroll(labelsEl, timelineEl);
        timelineEl.addEventListener('scroll', h1);
        labelsEl.addEventListener('scroll', h2);
        return () => { timelineEl.removeEventListener('scroll', h1); labelsEl.removeEventListener('scroll', h2); };
    }, []);

    useLayoutEffect(() => {
        if (lastZoomPoint.current.time !== null && timelineRef.current) {
            const { time, x } = lastZoomPoint.current;
            timelineRef.current.scrollLeft = (time * zoom) - x;
        }
    }, [zoom]);

    const prevZoomRef = useRef(zoom);
    useEffect(() => {
        const el = timelineRef.current;
        if (!el || duration <= 0) return;

        // Disable playhead tracking on zoom
        if (prevZoomRef.current !== zoom) {
            prevZoomRef.current = zoom;
            return;
        }

        const headX = currentTime * zoom;
        const scrollLeft = el.scrollLeft;
        const viewportWidth = el.clientWidth;
        const padding = 40; // Safe margin

        // Playhead beyond viewport (right)
        if (headX > (scrollLeft + viewportWidth - padding)) {
            // Scroll ahead if too far
            el.scrollLeft = headX - viewportWidth + padding + 100;
        }
        // Playhead behind viewport (left)
        else if (headX < scrollLeft) {
            el.scrollLeft = Math.max(0, headX - padding);
        }
    }, [currentTime, zoom, duration]);

    useEffect(() => {
        const timelineEl = timelineRef.current;
        if (!timelineEl) return;
        const handleWheel = (e: WheelEvent) => {
            if (e.shiftKey) return;
            if (e.ctrlKey) {
                e.preventDefault(); e.stopPropagation();
                const rect = timelineEl.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const timeAtMouse = (timelineEl.scrollLeft + mouseX) / zoom;
                const zoomFactor = e.deltaY < 0 ? 1.05 : 0.95;
                const newZoom = Math.max(0.1, Math.min(100, zoom * zoomFactor));
                lastZoomPoint.current = { time: timeAtMouse, x: mouseX };
                setZoom(newZoom);
            }
        };
        timelineEl.addEventListener('wheel', handleWheel, { passive: false });
        return () => timelineEl.removeEventListener('wheel', handleWheel);
    }, [zoom, setZoom]);

    // === Handlers ===
    const addVideoTrack = useCallback(() => {
        const videoCount = tracks.filter(tr => tr.type === 'video').length;
        const newTrack: Track = { id: Date.now() + Math.random(), type: 'video', name: t('video.track_video') + ` ${videoCount + 1}`, clips: [] };
        const newTracks = [newTrack, ...tracks];
        setTracks(newTracks);
        onCommit(t('history.add_track') || 'Track Ekle', newTracks);
    }, [tracks, setTracks, t, onCommit]);

    const addAudioTrack = useCallback(() => {
        const audioCount = tracks.filter(tr => tr.type === 'audio').length;
        const newTrack: Track = { id: Date.now() + Math.random(), type: 'audio', name: t('video.track_audio') + ` ${audioCount + 1}`, clips: [] };
        const lastVideoIdx = tracks.reduce((acc, tr, i) => tr.type === 'video' ? i : acc, -1);
        const newTracks = [...tracks.slice(0, lastVideoIdx + 1), newTrack, ...tracks.slice(lastVideoIdx + 1)];
        setTracks(newTracks);
        onCommit(t('history.add_track') || 'Track Ekle', newTracks);
    }, [tracks, setTracks, t, onCommit]);

    const deleteTrack = useCallback((trackId: number) => {
        const trackToDelete = tracks.find(tr => tr.id === trackId);
        if (!trackToDelete) return;

        const sameTypeTracks = tracks.filter(tr => tr.type === trackToDelete.type);
        if (sameTypeTracks.length <= 1) return; // Prevent deleting the last track of a type

        const newTracks = tracks.filter(tr => tr.id !== trackId);
        setTracks(newTracks);
        onCommit(t('history.delete_track') || 'Track Sil', newTracks);
    }, [tracks, setTracks, onCommit, t]);

    const removeGap = useCallback(() => {
        if (selectedClipId === null) return;

        let targetClip: Clip | null = null;
        let trackId: number | null = null;

        for (const tr of tracks) {
            const clip = tr.clips.find(c => c.id === selectedClipId);
            if (clip) {
                targetClip = clip;
                trackId = tr.id;
                break;
            }
        }

        if (!targetClip || trackId === null) return;

        const track = tracks.find(tr => tr.id === trackId)!;
        const otherClips = track.clips
            .filter(c => c.id !== selectedClipId)
            .sort((a, b) => a.timelineStart - b.timelineStart);

        let newStart = 0;
        const previousClip = [...otherClips].reverse().find(c => c.timelineStart + c.duration <= targetClip!.timelineStart + 0.001);

        if (previousClip) {
            newStart = previousClip.timelineStart + previousClip.duration;
        }

        if (Math.abs(targetClip.timelineStart - newStart) < 0.001) return;

        const newTracks = tracks.map(tr => {
            if (tr.id === trackId) {
                return {
                    ...tr,
                    clips: tr.clips.map(c => c.id === selectedClipId ? { ...c, timelineStart: newStart } : c)
                };
            }
            return tr;
        });

        setTracks(newTracks);
        onCommit(t('history.remove_gap') || 'Boşluğu Kapat', newTracks);
    }, [selectedClipId, tracks, setTracks, onCommit, t]);

    const handleAddClip = useCallback(async (trackId: number) => {
        try {
            const selected = await open({ multiple: false, filters: [{ name: 'Media', extensions: ['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'm4a', 'png', 'tif', 'gif'] }] });
            if (selected && typeof selected === 'string') {
                const filename = selected.split(/[\\/]/).pop() || 'Untitled';
                const details = await invoke<any>('get_file_details', { path: selected, galleryRoot: galleryRoot || '' }).catch(() => null);
                const clipDuration = details?.duration || 10;
                const newClipId = Date.now() + Math.random();
                const newTracks = tracks.map(tr => tr.id === trackId ? {
                    ...tr, clips: [...tr.clips, {
                        id: newClipId,
                        path: selected,
                        name: filename,
                        timelineStart: currentTime,
                        sourceStart: 0,
                        duration: clipDuration,
                        mtime: details?.mtime,
                        width: details?.width,
                        height: details?.height
                    }]
                } : tr);
                setTracks(newTracks);
                setSelectedClipId(newClipId);
                onCommit(t('history.add_clip') || 'Klip Ekle', newTracks);
            }
        } catch (err) { /* ignore */ }
    }, [tracks, currentTime, setTracks, galleryRoot, t, setSelectedClipId, onCommit]);

    const handleAddTextClip = useCallback((trackId: number) => {
        const newClipId = Date.now() + Math.random();
        const newTracks = tracks.map(tr => tr.id === trackId ? {
            ...tr, clips: [...tr.clips, {
                id: newClipId,
                path: 'text_layer',
                name: 'Metin',
                timelineStart: currentTime,
                sourceStart: 0,
                duration: 10,
                width: 600,
                height: 120,
                type: 'text' as const,
                textData: {
                    text: 'Yeni Metin',
                    fontSize: 100,
                    color: '#ffffff',
                    fontFamily: 'Inter',
                    fontWeight: 'bold',
                    letterSpacing: 0
                }
            }]
        } : tr);
        setTracks(newTracks as Track[]);
        setSelectedClipId(newClipId);
        onCommit('Metin Ekle', newTracks);
    }, [tracks, currentTime, setTracks, setSelectedClipId, onCommit]);

    // === Ruler ===
    const rulerWidth = useMemo(() => Math.max(3000, duration * zoom + 500), [duration, zoom]);
    const rulerMarks = useMemo(() => {
        const marks: React.ReactNode[] = [];
        const totalSecs = Math.ceil(rulerWidth / zoom);

        // Define steps based on zoom level
        let step = 1;
        if (zoom < 1) step = 300;
        else if (zoom < 2) step = 60;
        else if (zoom < 5) step = 30;
        else if (zoom < 10) step = 10;
        else if (zoom < 25) step = 5;
        else if (zoom < 60) step = 2;
        else step = 1;

        const minorStep = step / 10; // More marks for a ruler feel
        const midStep = step / 2;

        for (let i = 0; i <= totalSecs; i += minorStep) {
            const isMajor = Math.abs(i % step) < 0.001 || Math.abs(i % step - step) < 0.001;
            const isMid = !isMajor && (Math.abs(i % midStep) < 0.001 || Math.abs(i % midStep - midStep) < 0.001);

            let markType = 'minor';
            if (isMajor) markType = 'major';
            else if (isMid) markType = 'mid';

            let label = '';
            if (isMajor) {
                const roundedI = Math.round(i);
                if (roundedI >= 3600) {
                    label = `${Math.floor(roundedI / 3600)}:${Math.floor((roundedI % 3600) / 60).toString().padStart(2, '0')}:${(roundedI % 60).toString().padStart(2, '0')}`;
                } else if (roundedI >= 60) {
                    label = `${Math.floor(roundedI / 60)}:${(roundedI % 60).toString().padStart(2, '0')}`;
                } else {
                    label = `${roundedI}s`;
                }
            }

            marks.push(
                <div key={i} className={`ve-ruler-mark ${markType}`} style={{ left: `${i * zoom}px` }}>
                    {label && <span className="ve-ruler-label">{label}</span>}
                </div>
            );
        }
        return marks;
    }, [rulerWidth, zoom]);

    // === Interactions ===
    const getSnapPoints = useCallback((excludeClipId?: number) => {
        const snapPoints: number[] = [0, currentTime]; // Include playhead as snap target
        tracks.forEach(track => track.clips.forEach(clip => {
            if (clip.id !== excludeClipId) {
                snapPoints.push(clip.timelineStart);
                snapPoints.push(clip.timelineStart + clip.duration);
            }
        }));
        return snapPoints;
    }, [tracks, currentTime]);

    // Snapping for a single point (used by playhead, trim handles)
    const applySnapping = useCallback((time: number, excludeClipId?: number) => {
        const pts = getSnapPoints(excludeClipId);
        const threshold = 10 / zoom;
        let best = time; let min = threshold;
        pts.forEach(p => { const d = Math.abs(time - p); if (d < min) { min = d; best = p; } });
        return best;
    }, [getSnapPoints, zoom]);

    // Snapping for clip drag: checks BOTH clip start AND clip end against snap points
    const applyClipSnapping = useCallback((clipStart: number, clipDuration: number, excludeClipId?: number) => {
        const pts = getSnapPoints(excludeClipId);
        const threshold = 10 / zoom;
        const clipEnd = clipStart + clipDuration;
        let bestOffset = 0;
        let minDist = threshold;

        // Check clip START against all snap points
        pts.forEach(p => {
            const d = Math.abs(clipStart - p);
            if (d < minDist) { minDist = d; bestOffset = p - clipStart; }
        });

        // Check clip END against all snap points
        pts.forEach(p => {
            const d = Math.abs(clipEnd - p);
            if (d < minDist) { minDist = d; bestOffset = p - clipEnd; }
        });

        return Math.max(0, clipStart + bestOffset);
    }, [getSnapPoints, zoom]);

    const handlePlayheadDrag = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const up = (ev: MouseEvent) => {
            const rect = timelineRef.current?.getBoundingClientRect();
            if (rect) setCurrentTime(applySnapping(Math.max(0, (ev.clientX - rect.left + timelineRef.current!.scrollLeft) / zoom)));
        };
        const move = (ev: MouseEvent) => up(ev);
        const end = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        up(e.nativeEvent);
    }, [zoom, setCurrentTime, applySnapping]);


    const handleTrackDrag = useCallback((e: React.MouseEvent, trackId: number) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        const startY = e.clientY;
        const initialTracks = JSON.parse(JSON.stringify(tracks));
        const idx = tracks.findIndex(tr => tr.id === trackId);
        const move = (ev: MouseEvent) => {
            const steps = Math.round((ev.clientY - startY) / 56);
            if (steps !== 0) {
                const newIdx = Math.max(0, Math.min(tracks.length - 1, idx + steps));
                if (newIdx !== idx) {
                    const next = [...tracks]; const [m] = next.splice(idx, 1); next.splice(newIdx, 0, m);
                    setTracks(next);
                }
            }
        };
        const end = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end);
            if (JSON.stringify(tracks) !== JSON.stringify(initialTracks)) onCommit(t('history.reorder_tracks') || 'Track Sıralama', latestTracksRef.current);
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    }, [tracks, setTracks, onCommit, t]);

    const handleClipDrag = useCallback((e: React.MouseEvent, clip: Clip) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const origStart = clip.timelineStart;
        const originalTrackId = tracks.find(tr => tr.clips.some(c => c.id === clip.id))?.id;
        const trackIds = tracks.map(t => t.id);

        let dupClipId: number | null = null;
        let lastIsDup = false;

        const move = (ev: MouseEvent) => {
            const isDup = ev.ctrlKey;
            lastIsDup = isDup;
            const rawStart = Math.max(0, origStart + (ev.clientX - startX) / zoom);
            const snappedStart = applyClipSnapping(rawStart, clip.duration, isDup ? undefined : clip.id);
            const newStart = Math.round(snappedStart * 10000) / 10000;
            const rect = timelineRef.current?.getBoundingClientRect();
            if (!rect) return;

            // 56 is track height. Handle vertical scroll of timeline content.
            const targetTrackIdx = Math.max(0, Math.min(trackIds.length - 1, Math.floor((ev.clientY - rect.top - 28 + (timelineRef.current?.scrollTop || 0)) / 56)));
            const targetTrackId = trackIds[targetTrackIdx];

            setTracks(prev => {
                if (!isDup) {
                    // Normal Move
                    const currentWithClip = prev.find(tr => tr.clips.some(c => c.id === clip.id));
                    const currentTrackId = currentWithClip?.id;

                    return prev.map(tr => {
                        let clips = tr.clips.filter(c => c.id !== clip.id && c.id !== (dupClipId || -1));
                        if (tr.id === targetTrackId) return { ...tr, clips: [...clips, { ...clip, timelineStart: newStart }] };
                        if (tr.id === currentTrackId) return { ...tr, clips };
                        return { ...tr, clips };
                    });
                } else {
                    // Duplicate
                    if (!dupClipId) dupClipId = Date.now() + Math.random();
                    return prev.map(tr => {
                        let clips = tr.clips.filter(c => c.id !== dupClipId);

                        // 1. Ensure original clip is in its starting track at starting position
                        if (tr.id === originalTrackId) {
                            if (!clips.some(c => c.id === clip.id)) {
                                clips = [...clips, { ...clip, timelineStart: origStart }];
                            } else {
                                clips = clips.map(c => c.id === clip.id ? { ...clip, timelineStart: origStart } : c);
                            }
                        } else {
                            // Clear original from other tracks if it was moved before pressing Ctrl
                            clips = clips.filter(c => c.id !== clip.id);
                        }

                        // 2. Add/Update duplicate in target track
                        if (tr.id === targetTrackId) {
                            clips = [...clips.filter(c => c.id !== dupClipId), { ...clip, id: dupClipId!, timelineStart: newStart }];
                        }

                        return { ...tr, clips };
                    });
                }
            });
        };

        const end = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', end);

            const isDup = ev.ctrlKey || lastIsDup;
            if (isDup && dupClipId) {
                setSelectedClipId(dupClipId);
            }

            const label = isDup ? (t('history.duplicate_clip') || 'Klip Çoğalt') : (t('history.move_clip') || 'Klip Taşıma');
            onCommit(label, latestTracksRef.current);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
    }, [zoom, setTracks, tracks, applyClipSnapping, onCommit, t, setSelectedClipId]);

    const handleTrimLeft = useCallback((e: React.MouseEvent, clip: Clip) => {
        e.stopPropagation();
        const startX = e.clientX;
        const oS = clip.timelineStart;
        const oD = clip.duration;
        const oSS = clip.sourceStart;
        const oSp = clip.speed || 1;
        const isRateStretch = e.altKey;

        const move = (ev: MouseEvent) => {
            const delta = Math.min((ev.clientX - startX) / zoom, oD - 0.1);
            if (isRateStretch) {
                const newDuration = Math.max(0.1, oD - delta);
                const newSpeed = (oD * oSp) / newDuration;
                setTracks(prev => prev.map(tr => ({
                    ...tr, clips: tr.clips.map(c => c.id === clip.id ? { ...c, timelineStart: oS + delta, duration: newDuration, speed: newSpeed } : c)
                })));
            } else {
                setTracks(prev => prev.map(tr => ({
                    ...tr, clips: tr.clips.map(c => c.id === clip.id ? {
                        ...c,
                        timelineStart: Math.round(Math.max(0, oS + delta) * 10000) / 10000,
                        sourceStart: Math.round(Math.max(0, oSS + (delta * oSp)) * 10000) / 10000,
                        duration: Math.round(Math.max(0.1, oD - delta) * 10000) / 10000
                    } : c)
                })));
            }
        };
        const end = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', end);
            const label = isRateStretch ? (t('history.rate_stretch') || 'Klip Esnetme') : (t('history.trim_clip') || 'Klip Kırpma');
            onCommit(label, latestTracksRef.current);
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    }, [zoom, setTracks, onCommit, t]);

    const handleTrimRight = useCallback((e: React.MouseEvent, clip: Clip) => {
        e.stopPropagation();
        const startX = e.clientX;
        const oD = clip.duration;
        const oSp = clip.speed || 1;
        const isRateStretch = e.altKey;

        const move = (ev: MouseEvent) => {
            const delta = (ev.clientX - startX) / zoom;
            if (isRateStretch) {
                const newDuration = Math.max(0.1, oD + delta);
                const newSpeed = (oD * oSp) / newDuration;
                setTracks(prev => prev.map(tr => ({
                    ...tr, clips: tr.clips.map(c => c.id === clip.id ? { ...c, duration: newDuration, speed: newSpeed } : c)
                })));
            } else {
                setTracks(prev => prev.map(tr => ({
                    ...tr, clips: tr.clips.map(c => c.id === clip.id ? { ...c, duration: Math.round(Math.max(0.1, oD + delta) * 10000) / 10000 } : c)
                })));
            }
        };
        const end = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', end);
            const label = isRateStretch ? (t('history.rate_stretch') || 'Klip Esnetme') : (t('history.trim_clip') || 'Klip Kırpma');
            onCommit(label, latestTracksRef.current);
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    }, [zoom, setTracks, onCommit, t]);

    const handleDrop = useCallback((e: React.DragEvent, trackId: number) => {
        e.preventDefault();
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0);
            const next = tracks.map(tr => tr.id === trackId ? {
                ...tr, clips: [...tr.clips, {
                    id: Date.now() + Math.random(),
                    path: data.path,
                    name: data.filename,
                    timelineStart: x / zoom,
                    sourceStart: 0,
                    duration: data.duration || 10,
                    mtime: data.mtime,
                    width: data.width,
                    height: data.height
                }]
            } : tr);
            setTracks(next);
            onCommit(t('history.drag_drop_clip') || 'Klip Sürükle Bırak', next);
        } catch (_) { }
    }, [zoom, tracks, setTracks, onCommit, t]);

    const handleResetDuration = useCallback(async (e: React.MouseEvent, clip: Clip) => {
        e.stopPropagation();

        let baseDuration = 10;
        if (clip.type === 'text' || clip.type === 'image') {
            baseDuration = 10;
        } else {
            try {
                const details = await invoke<any>('get_file_details', { path: clip.path, galleryRoot: galleryRoot || '' }).catch(() => null);
                if (details && details.duration) {
                    baseDuration = details.duration;
                }
            } catch (err) {
            }
        }

        const oSp = clip.speed || 1;
        const newDuration = baseDuration / oSp;

        setTracks(prevTracks => {
            const nextTracks = prevTracks.map(tr => ({
                ...tr,
                clips: tr.clips.map(c =>
                    c.id === clip.id
                        ? { ...c, duration: newDuration, sourceStart: 0, timelineStart: Math.max(0, clip.timelineStart - (clip.sourceStart / (clip.speed || 1))) }
                        : c
                )
            }));
            setTimeout(() => {
                onCommit(t('history.reset_clip_duration') || 'Süreyi Sıfırla', nextTracks);
            }, 0);
            return nextTracks;
        });
    }, [galleryRoot, setTracks, onCommit, t]);

    return (
        <div className="ve-timeline">
            <div className="ve-timeline-toolbar">
                <div className="ve-tl-tools">
                    <Tooltip text={t('tooltip.split')}><button className="ve-tl-btn ve-tl-btn-split" onClick={splitSelectedClip}><Scissors size={14} /></button></Tooltip>
                    <Tooltip text={t('tooltip.remove_gap')}><button className="ve-tl-btn" style={{ color: '#60a5fa' }} onClick={removeGap} disabled={selectedClipId === null}><ArrowLeftToLine size={14} /></button></Tooltip>
                    <Tooltip text={t('tooltip.delete')}><button className="ve-tl-btn ve-tl-btn-delete" onClick={deleteSelectedClip}><Trash2 size={14} /></button></Tooltip>
                    <div className="ve-tl-divider" />
                    <Tooltip text={t('tooltip.add_video_track')}><button className="ve-tl-btn ve-tl-btn-add-video" onClick={addVideoTrack}><VideoIcon size={14} /><Plus size={10} /></button></Tooltip>
                    <Tooltip text={t('tooltip.add_audio_track')}><button className="ve-tl-btn ve-tl-btn-add-audio" onClick={addAudioTrack}><Music size={14} /><Plus size={10} /></button></Tooltip>
                </div>
                <div className="ve-tl-zoom">
                    <Tooltip text={t('tooltip.zoom_out')}><button className="ve-tl-btn" onClick={() => setZoom(prev => Math.max(0.1, prev - 2))}><ZoomOut size={13} /></button></Tooltip>
                    <span className="ve-tl-zoom-label">{zoom.toFixed(1)}x</span>
                    <Tooltip text={t('tooltip.zoom_in')}><button className="ve-tl-btn" onClick={() => setZoom(prev => Math.min(100, prev + 2))}><ZoomIn size={13} /></button></Tooltip>
                </div>
            </div>
            <div className="ve-timeline-content">
                <div ref={trackLabelsRef} className="ve-track-labels">
                    <div className="ve-label-spacer" />
                    {tracks.map(track => (
                        <div key={track.id} className="ve-track-label">
                            <Tooltip text={track.name}>
                                <div
                                    className={`ve-track-icon ${track.type}`}
                                    onMouseDown={e => handleTrackDrag(e, track.id)}
                                >
                                    {track.type === 'video' ? <VideoIcon size={12} /> : <Music size={12} />}
                                </div>
                            </Tooltip>
                            <div className="ve-track-actions">
                                {track.type === 'video' && (
                                    <Tooltip text={t('editor.add_text') || 'Metin Ekle'}>
                                        <button className="ve-track-add-text" onClick={(e) => { e.stopPropagation(); handleAddTextClip(track.id); }}><Type size={11} strokeWidth={2.5} /></button>
                                    </Tooltip>
                                )}
                                <Tooltip text={t('tooltip.add_clip')}><button className="ve-track-add-clip" onClick={(e) => { e.stopPropagation(); handleAddClip(track.id); }}><Plus size={11} strokeWidth={3} /></button></Tooltip>
                                <Tooltip text={t('tooltip.delete_track')}><button className="ve-track-delete" onClick={(e) => { e.stopPropagation(); deleteTrack(track.id); }}><Trash2 size={11} /></button></Tooltip>
                            </div>
                        </div>
                    ))}
                </div>
                <div ref={timelineRef} className="ve-timeline-scroll" onMouseDown={(e) => {
                    const target = e.target as HTMLElement;
                    if (!target.closest('[data-clip-id]') && !target.closest('.ve-ruler') && !target.closest('.ve-playhead')) {
                        setSelectedClipId(null);
                    }
                }}>
                    <div className="ve-ruler" style={{ width: rulerWidth }} onMouseDown={handlePlayheadDrag}>{rulerMarks}</div>
                    {tracks.map(track => (
                        <div key={track.id} className="ve-track-lane" style={{ width: rulerWidth }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => handleDrop(e, track.id)}>
                            {track.clips.map(clip => (
                                <div key={clip.id} className={`ve-clip ${track.type} ${selectedClipId === clip.id ? 'selected' : ''}`} style={{ left: `${clip.timelineStart * zoom}px`, width: `${clip.duration * zoom}px` }} onClick={e => { e.stopPropagation(); setSelectedClipId(clip.id); }} onMouseDown={e => handleClipDrag(e, clip)}>
                                    <ClipVisual clip={clip} zoom={zoom} type={track.type} />
                                    {selectedClipId === clip.id && <><div className="ve-trim-handle left" onMouseDown={e => handleTrimLeft(e, clip)} onDoubleClick={e => handleResetDuration(e, clip)}><div className="ve-trim-grip" /></div><div className="ve-trim-handle right" onMouseDown={e => handleTrimRight(e, clip)} onDoubleClick={e => handleResetDuration(e, clip)}><div className="ve-trim-grip" /></div></>}
                                    <span className="ve-clip-name">{clip.name} {clip.speed && Math.abs(clip.speed - 1) > 0.01 ? `(${clip.speed.toFixed(2)}x)` : ''}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                    <div className="ve-playhead" style={{ left: `${currentTime * zoom}px`, height: `${28 + tracks.length * 56}px` }}>
                        <div className="ve-playhead-head" onMouseDown={handlePlayheadDrag} /><div className="ve-playhead-line" />
                    </div>
                </div>
            </div>
        </div>
    );
};
export default Timeline;
