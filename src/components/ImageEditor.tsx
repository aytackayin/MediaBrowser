import React, { useState, useEffect, useRef } from 'react';
import { motion, useDragControls } from 'framer-motion';
import {
    X, Save, RotateCcw, RotateCw, Sun, Contrast, Droplets, Move,
    ChevronDown, ChevronRight, Crop, Lock, Unlock,
    MousePointer2, Maximize, LayoutTemplate, Layers, Type, Trash2, Check, Sliders, Palette, ArrowLeftRight, Undo2, Redo2,
    AlertCircle, Bell, FlipHorizontal, FlipVertical, RefreshCcw as ResetIcon, Image as ImageIcon, Folder, Plus
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import './ImageEditor.css';

interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
    size: number;
    mtime: number;
    width?: number;
    height?: number;
}

interface ImageEditorProps {
    file: MediaFile;
    onClose: () => void;
    onSaveSuccess: (file: MediaFile) => void;
    galleryRoot?: string;
}

interface TextLayer {
    id: string;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color: string;
    rotation: number;
    fontFamily?: string;
    fontWeight?: string;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    exposure?: number;
    sepia?: number;
    hue?: number;
    opacity?: number;
    blur?: number;
    gamma?: number;
    temp?: number;
    tint?: number;
    vibrance?: number;
    clarity?: number;
    shR?: number; shG?: number; shB?: number;
    midR?: number; midG?: number; midB?: number;
    hiR?: number; hiG?: number; hiB?: number;
    blendMode?: string;
    letterSpacing?: number;
    flipH?: boolean;
    flipV?: boolean;
    dehaze?: number;
}

interface ImageLayer {
    id: string;
    src: string;
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipH?: boolean;
    flipV?: boolean;
    opacity?: number;
    blur?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    exposure?: number;
    sepia?: number;
    hue?: number;
    gamma?: number;
    temp?: number;
    tint?: number;
    vibrance?: number;
    clarity?: number;
    shR?: number; shG?: number; shB?: number;
    midR?: number; midG?: number; midB?: number;
    hiR?: number; hiG?: number; hiB?: number;
    blendMode?: string;
    dehaze?: number;
}

interface Preset {
    id: string;
    name: string;
    settings: any;
}

// --- Helper Components ---

// Helper function to clamp panel position within viewport
const clampToViewport = (pos: { x: number, y: number }, panelWidth: number = 260) => {
    const padding = 20;
    const minVisible = 100; // At least 100px of panel must be visible

    const maxX = window.innerWidth - minVisible;
    const maxY = window.innerHeight - minVisible;
    const minX = -panelWidth + minVisible;
    const minY = padding; // Keep at least padding from top

    return {
        x: Math.max(minX, Math.min(maxX, pos.x)),
        y: Math.max(minY, Math.min(maxY, pos.y))
    };
};

const DraggableDock = ({ id, initialPos, children }: any) => {
    const { t } = useLanguage();
    const dragControls = useDragControls();
    const [pos, setPos] = useState(() => {
        try {
            const p = localStorage.getItem(`dock_pos_${id}`);
            const savedPos = p ? JSON.parse(p) : initialPos;
            return clampToViewport(savedPos);
        } catch { return clampToViewport(initialPos); }
    });

    useEffect(() => {
        const handleResize = () => setPos(prev => clampToViewport(prev));
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={pos}
            animate={pos}
            onDragEnd={(_e, info) => {
                const absoluteX = pos.x + info.offset.x;
                const absoluteY = pos.y + info.offset.y;
                const newPos = clampToViewport({ x: absoluteX, y: absoluteY });
                setPos(newPos);
                localStorage.setItem(`dock_pos_${id}`, JSON.stringify(newPos));
            }}
            className="panel-dock"
            style={{ position: 'fixed', zIndex: 4000, display: 'flex', flexDirection: 'column', gap: 0, top: 0, left: 0 }}
        >
            <div
                onPointerDown={(e) => dragControls.start(e)}
                className="dock-handle"
            >
                <div className="dock-dots">
                    <LayoutTemplate size={12} />
                    <span>{id === 'left' ? t('editor.tools') : t('editor.layers_history')}</span>
                </div>
            </div>
            <div className="dock-content">
                {children}
            </div>
        </motion.div>
    );
};

const CollapsiblePanel = ({ id, title, icon: Icon, children, defaultCollapsed = false }: any) => {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try { return localStorage.getItem(`panel_collapsed_${id}`) === 'true'; } catch { return defaultCollapsed; }
    });

    useEffect(() => {
        localStorage.setItem(`panel_collapsed_${id}`, isCollapsed.toString());
    }, [isCollapsed, id]);

    return (
        <div className={`collapsible-panel-section ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="panel-section-header" onClick={() => setIsCollapsed(!isCollapsed)}>
                <div className="panel-title">
                    <Icon size={14} color="#888" />
                    <span>{title}</span>
                </div>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
            {!isCollapsed && (
                <div className="panel-section-content">
                    {children}
                </div>
            )}
        </div>
    );
};



const ControlSlider = ({ label, icon: Icon, value, min, max, step, field, onInput, onChange, defaultValue }: any) => {
    const isEditing_s = useState(false);
    const isEditing = isEditing_s[0];
    const setIsEditing = isEditing_s[1];
    const [inputValue, setInputValue] = useState("");
    const startVal = useRef(value);
    const isDragging = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const resetValue = defaultValue !== undefined ? defaultValue : 0;

    const handleCommit = () => {
        setIsEditing(false);
        let val = parseFloat(inputValue);
        if (isNaN(val)) return;
        val = Math.max(min, Math.min(max, val));
        onInput(field, val);
        if (val !== startVal.current && onChange) {
            onChange(label);
        }
    };

    const wheelTimeout = useRef<any>(null);

    useEffect(() => {
        const div = containerRef.current;
        if (!div) return;

        const handleWheel = (e: WheelEvent) => {
            const target = e.target as HTMLElement;
            const isValue = target.classList.contains('slider-value') || target.classList.contains('slider-value-input');
            const isRange = target.classList.contains('slider-input');

            if (isValue || isRange) {
                // Prevent panel scroll
                e.preventDefault();
                e.stopPropagation();

                // Value change only while editing
                if (isEditing && isValue) {
                    const delta = e.deltaY > 0 ? -step : step;
                    const currentBase = parseFloat(inputValue) || value;
                    const newVal = Math.max(min, Math.min(max, currentBase + delta));

                    setInputValue(newVal.toFixed(2));
                    onInput(field, newVal);

                    if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
                    wheelTimeout.current = setTimeout(() => {
                        if (onChange) onChange(label);
                    }, 500);
                }
            }
        };

        div.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            div.removeEventListener('wheel', handleWheel);
            if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
        };
    }, [value, min, max, step, field, onInput, onChange, label, isEditing, inputValue]);

    return (
        <div className="control-slider-container is-slider" ref={containerRef}>
            <div className="slider-header">
                <div className="slider-label">
                    {Icon && <Icon size={12} />}
                    <span>{label}</span>
                </div>
                {isEditing ? (
                    <input
                        id={`slider-input-${field}`}
                        name={field}
                        type="number"
                        className="slider-value-input"
                        value={inputValue}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setInputValue(e.target.value)}
                        onBlur={handleCommit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommit();
                            if (e.key === 'Escape') setIsEditing(false);
                        }}
                        step={step}
                    />
                ) : (
                    <span
                        className="slider-value"
                        onClick={() => {
                            setInputValue((value ?? 0).toFixed(2));
                            setIsEditing(true);
                            startVal.current = value;
                        }}
                    >
                        {(value ?? 0).toFixed(2)}
                    </span>
                )}
            </div>
            <input
                id={`slider-range-${field}`}
                name={`${field}_range`}
                type="range"
                min={min} max={max} step={step}
                value={value}
                onPointerDown={(e) => {
                    const target = e.target as HTMLInputElement;
                    target.setPointerCapture(e.pointerId);
                    startVal.current = target.value;
                    isDragging.current = true;
                }}
                onInput={(e) => {
                    onInput(field, parseFloat((e.target as HTMLInputElement).value));
                }}
                onPointerUp={(e) => {
                    if (!isDragging.current) return;
                    const target = e.target as HTMLInputElement;
                    const currentVal = target.value;

                    if (currentVal !== startVal.current && onChange) {
                        onChange(label);
                    }

                    isDragging.current = false;
                    target.releasePointerCapture(e.pointerId);
                }}
                onDoubleClick={() => {
                    if (Math.abs(value - resetValue) > 0.001) {
                        onInput(field, resetValue);
                        if (onChange) onChange(label);
                    }
                }}
                className="slider-input"
            />
        </div>
    );
};

// --- Main Component ---

const ImageEditor: React.FC<ImageEditorProps> = ({ file, onClose, onSaveSuccess, galleryRoot }) => {
    const { t } = useLanguage();

    // -- States --
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const DEFAULT_SETTINGS = {
        brightness: 0.0, contrast: 0.0, gamma: 0.0, saturation: 0.0, exposure: 0.0,
        sepia: 0.0, hue: 0.0, temp: 0.0, tint: 0.0,
        vibrance: 0.0, clarity: 0.0,
        shR: 0.0, shG: 0.0, shB: 0.0,
        midR: 0.0, midG: 0.0, midB: 0.0,
        hiR: 0.0, hiG: 0.0, hiB: 0.0,
        blur: 0, opacity: 1,
        width: 0, height: 0, rotation: 0,
        x: 0, y: 0,
        flipH: false, flipV: false,
        dehaze: 0.0,
        crop: { x: 0, y: 0, w: 0, h: 0 }
    };

    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [currSrc, setCurrSrc] = useState('');
    const [displayFilename, setDisplayFilename] = useState(file.filename);

    useEffect(() => {
        setDisplayFilename(file.filename);
    }, [file.filename]);

    // Layers
    const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
    const [imageLayers, setImageLayers] = useState<ImageLayer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState<string | null>('bg');

    // Layout Signal
    const [layoutKey, setLayoutKey] = useState(0);

    // Presets
    const [presets, setPresets] = useState<Preset[]>(() => {
        const saved = localStorage.getItem('image_editor_presets');
        return saved ? JSON.parse(saved) : [
            { id: 'p1', name: 'Vivid', settings: { brightness: 1.2, contrast: 1.2, saturation: 1.3, exposure: 0.1 } },
            { id: 'p2', name: 'Noir', settings: { saturation: 0, contrast: 1.4, brightness: 0.9 } },
            { id: 'p3', name: 'Vintage', settings: { sepia: 0.8, contrast: 0.9, saturation: 0.7 } },
            { id: 'p4', name: 'Soft', settings: { blur: 5, brightness: 1.1, contrast: 0.9 } },
            { id: 'p5', name: 'Cold', settings: { hue: 0.1, saturation: 0.8, brightness: 1.05 } }
        ];
    });
    const [snapLines, setSnapLines] = useState<{ x?: number, y?: number } | null>(null);

    // Tools
    const [tool, setTool] = useState<'move' | 'crop' | 'resize' | 'text'>('move');
    const [isCropActive, setIsCropActive] = useState(false);
    const [isLocked, setIsLocked] = useState(true);
    const [cropAspect, setCropAspect] = useState<number | null>(null);

    // Modal & Toast States
    const [showSavePresetModal, setShowSavePresetModal] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [confirmModal, setConfirmModal] = useState<{ show: boolean, title: string, message: string, onConfirm: () => void, type?: 'danger' | 'primary' } | null>(null);
    const [notifications, setNotifications] = useState<{ id: string, message: string, type: 'success' | 'error' | 'info' }[]>([]);

    // Save Modal States
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [savePath, setSavePath] = useState('');
    const [saveFormat, setSaveFormat] = useState<'jpg' | 'png'>('jpg');
    const [isSaving, setIsSaving] = useState(false);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Math.random().toString(36).substr(2, 9);
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 3000);
    };

    const openConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'primary' = 'primary') => {
        setConfirmModal({ show: true, title, message, onConfirm, type });
    };

    // History
    const [undoStack, setUndoStack] = useState<any[]>([]);
    const [redoStack, setRedoStack] = useState<any[]>([]);
    const lastSavedState = useRef<string>(JSON.stringify({
        settings: DEFAULT_SETTINGS,
        textLayers: [],
        imageLayers: [],
        view: { scale: 1, x: 0, y: 0 },
        src: '',
        _historyLabel: t('editor.initial_history')
    }));

    const saveHistory = (label?: string, customNextState?: any) => {
        let nextState = customNextState ? { ...customNextState } : {
            settings: { ...settings },
            textLayers: JSON.parse(JSON.stringify(textLayers)),
            imageLayers: JSON.parse(JSON.stringify(imageLayers)),
            view: { ...view },
            src: currSrc
        };

        if (!nextState._historyLabel) {
            nextState._historyLabel = label || t('editor.adjustment_history');
        }

        const nextStateStr = JSON.stringify({ settings: nextState.settings, textLayers: nextState.textLayers, imageLayers: nextState.imageLayers, view: nextState.view });
        const lastFullState = JSON.parse(lastSavedState.current);
        const lastFullStr = JSON.stringify({ settings: lastFullState.settings, textLayers: lastFullState.textLayers, imageLayers: lastFullState.imageLayers, view: lastFullState.view });

        if (nextStateStr === lastFullStr) return;

        setUndoStack(prev => [...prev.slice(-49), lastFullState]);
        setRedoStack([]);
        lastSavedState.current = JSON.stringify(nextState);
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const currentData = {
            settings, textLayers, view,
            src: currSrc,
            _historyLabel: JSON.parse(lastSavedState.current)._historyLabel
        };
        const prev = undoStack[undoStack.length - 1];

        setRedoStack(rs => [...rs, currentData]);
        setSettings(prev.settings);
        setTextLayers(prev.textLayers || []);
        setImageLayers(prev.imageLayers || []);
        if (prev.view) setView(prev.view);
        if (prev.src && prev.src !== currSrc) loadImage(prev.src, false);

        // Safety: If active layer is missing in target state, switch to background
        if (activeLayerId !== 'bg' && (!prev.textLayers || !prev.textLayers.find((l: any) => l.id === activeLayerId))) {
            setActiveLayerId('bg');
        }

        setUndoStack(us => us.slice(0, -1));
        lastSavedState.current = JSON.stringify(prev);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const currentData = {
            settings, textLayers, view,
            src: currSrc,
            _historyLabel: JSON.parse(lastSavedState.current)._historyLabel
        };
        const next = redoStack[redoStack.length - 1];

        setUndoStack(us => [...us, currentData]);
        setSettings(next.settings);
        setTextLayers(next.textLayers || []);
        setImageLayers(next.imageLayers || []);
        if (next.view) setView(next.view);
        if (next.src && next.src !== currSrc) loadImage(next.src, false);

        // Safety: If active layer is missing in target state, switch to background
        if (activeLayerId !== 'bg' && (!next.textLayers || !next.textLayers.find((l: any) => l.id === activeLayerId))) {
            setActiveLayerId('bg');
        }

        setRedoStack(rs => rs.slice(0, -1));
        lastSavedState.current = JSON.stringify(next);
    };

    const revertToState = (index: number) => {
        const fullStack = [...undoStack, JSON.parse(lastSavedState.current), ...[...redoStack].reverse()];
        const target = fullStack[index];
        if (!target) return;

        // Re-calculate stacks
        const newUndo = fullStack.slice(0, index);
        const newRedo = fullStack.slice(index + 1).reverse();

        setSettings(target.settings);
        setTextLayers(target.textLayers || []);
        setImageLayers(target.imageLayers || []);
        if (target.view) setView(target.view);
        if (target.src && target.src !== currSrc) loadImage(target.src, false);

        // Safety: If active layer is missing in target state, switch to background
        if (activeLayerId !== 'bg' && (!target.textLayers || !target.textLayers.find((l: any) => l.id === activeLayerId))) {
            setActiveLayerId('bg');
        }

        setUndoStack(newUndo);
        setRedoStack(newRedo);
        lastSavedState.current = JSON.stringify(target);
    };

    const handleResetLayout = () => {
        // Clear saved positions
        const keys = Object.keys(localStorage);
        keys.forEach(k => {
            if (k.startsWith('dock_pos_') || k.startsWith('panel_collapsed_')) {
                localStorage.removeItem(k);
            }
        });
        setLayoutKey(prev => prev + 1);
        showToast(t('editor.layout_reset_success'), 'success');
    };

    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<WebGLRenderingContext | null>(null);
    const programRef = useRef<WebGLProgram | null>(null);
    const textureRef = useRef<WebGLTexture | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const historyInnerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (historyInnerRef.current) {
            const parent = historyInnerRef.current.parentElement;
            if (parent) {
                parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
            }
        }
    }, [undoStack.length]);

    const actionRef = useRef({
        type: null as 'pan' | 'resize' | 'crop' | 'move_text' | 'move_crop' | null,
        startX: 0, startY: 0,
        startViewX: 0, startViewY: 0,
        startW: 0, startH: 0,
        startCrop: { x: 0, y: 0, w: 0, h: 0 },
        handle: null as string | null,
        targetId: null as string | null,
        startFontSize: 0
    });

    // -- Shaders --
    const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform mat3 u_matrix;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
            v_texCoord = a_texCoord;
        }
    `;
    const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform float u_brightness;
        uniform float u_contrast;
        uniform float u_gamma;
        uniform float u_saturation;
        uniform float u_exposure;
        uniform float u_sepia;
        uniform float u_hue;
        uniform float u_temp;
        uniform float u_tint;
        uniform float u_vibrance;
        uniform float u_clarity;
        uniform float u_dehaze;
        uniform float u_width;
        uniform float u_height;
        uniform vec3 u_shadows;
        uniform vec3 u_midtones;
        uniform vec3 u_highlights;
        varying vec2 v_texCoord;
        
        vec3 rotateHue(vec3 c, float deg) {
            float a = deg * 0.0174532925; // deg * (PI / 180)
            float sa = sin(a);
            float ca = cos(a);
            // Standard SVG hueRotate matrix (Exact weights)
            return vec3(
                dot(c, vec3(0.213 + ca*0.787 - sa*0.213, 0.715 - ca*0.715 - sa*0.715, 0.072 - ca*0.072 + sa*0.928)),
                dot(c, vec3(0.213 - ca*0.213 + sa*0.143, 0.715 + ca*0.285 + sa*0.140, 0.072 - ca*0.072 - sa*0.283)),
                dot(c, vec3(0.213 - ca*0.213 - sa*0.787, 0.715 - ca*0.715 + sa*0.715, 0.072 + ca*0.928 + sa*0.072))
            );
        }

        void main() {
            vec4 color = texture2D(u_image, v_texCoord);
            
            // Exposure
            color.rgb *= pow(2.0, u_exposure);
            
            // Brightness (Normalized: 0 is neutral)
            color.rgb *= (u_brightness * 0.5 + 1.0);
            
            // Color Balance (Shadows, Midtones, Highlights)
            float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            float luminance = gray;
            
            // Weights for 3-way color balance
            float shadowWeight = clamp(1.0 - luminance * 2.0, 0.0, 1.0);
            float highlightWeight = clamp(luminance * 2.0 - 1.0, 0.0, 1.0);
            float midtoneWeight = clamp(1.0 - shadowWeight - highlightWeight, 0.0, 1.0);
            
            color.rgb += u_shadows * shadowWeight;
            color.rgb += u_midtones * midtoneWeight;
            color.rgb += u_highlights * highlightWeight;
            
            // Temperature & Tint
            color.r += u_temp * 0.15;
            color.b -= u_temp * 0.15;
            color.g += u_tint * 0.08;
            color.rb -= u_tint * 0.04;

            // Contrast (Normalized: 0 is neutral, smoothed scaling)
            color.rgb = (color.rgb - 0.5) * (u_contrast * 0.7 + 1.0) + 0.5;

            // Gamma (Normalized: 0 is neutral, Perceptual mapping)
            if (u_gamma != 0.0) {
                // Maps -1..1 to a smooth 0.33..3.0 range
                float gammaExponent = pow(2.0, -u_gamma * 1.2); 
                color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(gammaExponent));
            }

            // Clarity (Enhanced 9-tap Sharpening)
            if (u_clarity != 0.0) {
                float dx = 1.0 / u_width;
                float dy = 1.0 / u_height;
                
                vec3 c0 = texture2D(u_image, v_texCoord).rgb;
                vec3 c1 = texture2D(u_image, v_texCoord + vec2(-dx, -dy)).rgb;
                vec3 c2 = texture2D(u_image, v_texCoord + vec2(0.0, -dy)).rgb;
                vec3 c3 = texture2D(u_image, v_texCoord + vec2(dx, -dy)).rgb;
                vec3 c4 = texture2D(u_image, v_texCoord + vec2(-dx, 0.0)).rgb;
                vec3 c5 = texture2D(u_image, v_texCoord + vec2(dx, 0.0)).rgb;
                vec3 c6 = texture2D(u_image, v_texCoord + vec2(-dx, dy)).rgb;
                vec3 c7 = texture2D(u_image, v_texCoord + vec2(0.0, dy)).rgb;
                vec3 c8 = texture2D(u_image, v_texCoord + vec2(dx, dy)).rgb;
                
                vec3 surround = (c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8) * 0.125;
                color.rgb += (c0 - surround) * u_clarity * 3.0;
            }

            // Dehaze
            if (u_dehaze != 0.0) {
                float d = u_dehaze * 0.2;
                color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(1.0 + d));
                color.rgb = (color.rgb - d * 0.5) / (1.0 - d * 0.5);
                float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                color.rgb = mix(vec3(luma), color.rgb, 1.0 + u_dehaze * 0.2);
            }
            
            // Sepia
            gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 sepiaColor = vec3(gray * 1.2, gray * 1.0, gray * 0.8);
            color.rgb = mix(color.rgb, sepiaColor, u_sepia);
            
            // Saturation & Vibrance (Normalized: 0 is neutral)
            float mx = max(color.r, max(color.g, color.b));
            float saturationBoost = (u_saturation + 1.0) + (u_vibrance * (1.0 - mx) * 0.5);
            color.rgb = mix(vec3(gray), color.rgb, max(0.0, saturationBoost));
            
            // Hue
            if (u_hue != 0.0) {
                color.rgb = rotateHue(color.rgb, u_hue);
            }
            
            gl_FragColor = color;
        }
    `;

    // -- Init --
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!gl) return;
        glRef.current = gl;

        const compile = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { }
            return s;
        };
        const p = gl.createProgram()!;
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(p);
        programRef.current = p;

        loadImage(convertFileSrc(file.path) + `?t=${file.mtime}`, true);
    }, [file.path]);

    const resetAdjustments = () => {
        const resetObj = {
            brightness: 0.0, contrast: 0.0, gamma: 0.0, saturation: 0.0, exposure: 0.0,
            sepia: 0.0, hue: 0.0, temp: 0.0, tint: 0.0,
            vibrance: 0.0, clarity: 0.0, dehaze: 0.0,
            blur: 0, opacity: 1
        };

        if (!activeLayerId || activeLayerId === 'bg') {
            const nextSettings = { ...settings, ...resetObj };
            saveHistory(t('editor.reset_adjustments'), { settings: nextSettings, textLayers, imageLayers, view, src: currSrc });
            setSettings(nextSettings);
        } else {
            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, ...resetObj } : l));
            setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, ...resetObj } : l));
            saveHistory(t('editor.reset_adjustments'));
        }
    };

    const resetColorBalance = () => {
        const resetObj = {
            shR: 0.0, shG: 0.0, shB: 0.0,
            midR: 0.0, midG: 0.0, midB: 0.0,
            hiR: 0.0, hiG: 0.0, hiB: 0.0,
        };

        if (!activeLayerId || activeLayerId === 'bg') {
            const nextSettings = { ...settings, ...resetObj };
            saveHistory(t('editor.reset_color_balance'), { settings: nextSettings, textLayers, imageLayers, view, src: currSrc });
            setSettings(nextSettings);
        } else {
            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, ...resetObj } : l));
            setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, ...resetObj } : l));
            saveHistory(t('editor.reset_color_balance'));
        }
    };

    const resetTransform = () => {
        const nextSettings = {
            ...settings,
            rotation: 0, flipH: false, flipV: false
        };
        saveHistory(t('editor.reset_transform'), { settings: nextSettings, textLayers, view, src: currSrc });
        setSettings(nextSettings);
    };

    const loadImage = (src: string, isFirstLoad = true) => {
        setCurrSrc(src);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        img.onload = () => {
            imageRef.current = img;

            if (isFirstLoad) {
                setSettings(prev => ({
                    ...prev,
                    width: img.width,
                    height: img.height,
                    crop: { x: 0, y: 0, w: img.width, h: img.height }
                }));

                let initialView = { scale: 1, x: 0, y: 0 };
                if (containerRef.current) {
                    const cw = containerRef.current.clientWidth - 100;
                    const ch = containerRef.current.clientHeight - 100;
                    const scale = Math.min(cw / img.width, ch / img.height, 1);
                    const x = (containerRef.current.clientWidth - img.width * scale) / 2;
                    const y = (containerRef.current.clientHeight - img.height * scale) / 2;
                    initialView = { scale, x, y };
                    setView(initialView);
                }

                const initialState = {
                    settings: {
                        ...DEFAULT_SETTINGS,
                        width: img.width,
                        height: img.height,
                        crop: { x: 0, y: 0, w: img.width, h: img.height }
                    },
                    textLayers: [],
                    imageLayers: [],
                    view: initialView,
                    src: src,
                    _historyLabel: t('editor.original_image')
                };
                lastSavedState.current = JSON.stringify(initialState);
            } else {
                setSettings(prev => ({ ...prev, width: img.width, height: img.height }));
            }

            if (glRef.current) setupTexture(glRef.current, img);
            requestAnimationFrame(draw);
        };
    };

    const setupTexture = (gl: WebGLRenderingContext, img: HTMLImageElement | HTMLCanvasElement) => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        textureRef.current = tex;

        const pLoc = gl.getAttribLocation(programRef.current!, 'a_position');
        const tLoc = gl.getAttribLocation(programRef.current!, 'a_texCoord');

        const pBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(pLoc);
        gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

        const tBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(tLoc);
        gl.vertexAttribPointer(tLoc, 2, gl.FLOAT, false, 0, 0);
    };

    const draw = () => {
        const gl = glRef.current;
        const prog = programRef.current;
        if (!gl || !prog || !textureRef.current) return;

        // ROTATION FIX: Swap W/H when rotated 90/270 degrees
        const isVertical = Math.abs(settings.rotation % 180) === 90;
        const canvasW = isVertical ? settings.height : settings.width;
        const canvasH = isVertical ? settings.width : settings.height;

        if (canvasRef.current && (canvasRef.current.width !== canvasW || canvasRef.current.height !== canvasH)) {
            canvasRef.current.width = canvasW;
            canvasRef.current.height = canvasH;
            gl.viewport(0, 0, canvasW, canvasH);
        }

        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRef.current);

        gl.uniform1i(gl.getUniformLocation(prog, "u_image"), 0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_brightness"), settings.brightness);
        gl.uniform1f(gl.getUniformLocation(prog, "u_contrast"), settings.contrast);
        gl.uniform1f(gl.getUniformLocation(prog, "u_gamma"), settings.gamma);
        gl.uniform1f(gl.getUniformLocation(prog, "u_saturation"), settings.saturation);
        gl.uniform1f(gl.getUniformLocation(prog, "u_exposure"), settings.exposure);
        gl.uniform1f(gl.getUniformLocation(prog, "u_sepia"), settings.sepia);
        gl.uniform1f(gl.getUniformLocation(prog, "u_hue"), settings.hue * 180.0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_temp"), settings.temp);
        gl.uniform1f(gl.getUniformLocation(prog, "u_tint"), settings.tint);
        gl.uniform1f(gl.getUniformLocation(prog, "u_vibrance"), settings.vibrance);
        gl.uniform1f(gl.getUniformLocation(prog, "u_width"), imageRef.current?.width || 1024.0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_height"), imageRef.current?.height || 1024.0);
        gl.uniform1f(gl.getUniformLocation(prog, "u_highlights_b"), settings.hiB);
        gl.uniform1f(gl.getUniformLocation(prog, "u_clarity"), settings.clarity);
        gl.uniform1f(gl.getUniformLocation(prog, "u_dehaze"), settings.dehaze);
        gl.uniform3f(gl.getUniformLocation(prog, "u_shadows"), settings.shR, settings.shG, settings.shB);
        gl.uniform3f(gl.getUniformLocation(prog, "u_midtones"), settings.midR, settings.midG, settings.midB);
        gl.uniform3f(gl.getUniformLocation(prog, "u_highlights"), settings.hiR, settings.hiG, settings.hiB);

        let matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

        // Apply Flip
        if (settings.flipH) matrix[0] *= -1;
        if (settings.flipV) matrix[4] *= -1;

        const rad = (settings.rotation * Math.PI) / 180;
        const s = Math.sin(rad);
        const c = Math.cos(rad);

        // Rotation matrix: [c, s, 0, -s, c, 0, 0, 0, 1]
        // Combining with flip: Flip matrix is [fH, 0, 0, 0, fV, 0, 0, 0, 1]
        // Result = Rotate * Flip
        const m0 = matrix[0] * c;
        const m1 = matrix[0] * s;
        const m3 = matrix[4] * -s;
        const m4 = matrix[4] * c;

        matrix[0] = m0; matrix[1] = m1;
        matrix[3] = m3; matrix[4] = m4;

        gl.uniformMatrix3fv(gl.getUniformLocation(prog, "u_matrix"), false, matrix);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    useEffect(() => { requestAnimationFrame(draw); }, [settings]);


    // -- Crop --
    const applyCrop = async () => {
        const { x, y, w, h } = settings.crop;

        if (!activeLayerId || activeLayerId === 'bg') {
            if (!canvasRef.current) return;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasRef.current.width;
            tempCanvas.height = canvasRef.current.height;
            const ctx = tempCanvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(canvasRef.current, 0, 0);

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = w;
            cropCanvas.height = h;
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) return;

            cropCtx.drawImage(tempCanvas, x, y, w, h, 0, 0, w, h);

            const newSrc = cropCanvas.toDataURL();
            const nextTextLayers = textLayers.map(l => ({ ...l, x: l.x - x, y: l.y - y }));
            const nextImageLayers = imageLayers.map(l => ({ ...l, x: l.x - x, y: l.y - y }));

            const nextSettings = {
                ...settings,
                rotation: 0,
                width: w, height: h,
                crop: { x: 0, y: 0, w, h }
            };

            saveHistory(t('editor.history_crop'), { settings: nextSettings, textLayers: nextTextLayers, imageLayers: nextImageLayers, view, src: newSrc });

            loadImage(newSrc, false);
            setSettings(nextSettings);
            setTextLayers(nextTextLayers);
            setImageLayers(nextImageLayers);
            setIsCropActive(false);
            setTool('move');
        } else {
            const layer = imageLayers.find(l => l.id === activeLayerId);
            if (!layer) {
                setIsCropActive(false);
                setTool('move');
                return;
            }

            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';

                await new Promise((resolve, reject) => {
                    img.onload = () => resolve(null);
                    img.onerror = () => reject(new Error('Image load failed'));
                    img.src = layer.src;
                    if (img.complete && img.naturalWidth) resolve(null);
                });

                const cropCanvas = document.createElement('canvas');
                const finalW = Math.max(1, Math.round(w));
                const finalH = Math.max(1, Math.round(h));
                cropCanvas.width = finalW;
                cropCanvas.height = finalH;

                const ctx = cropCanvas.getContext('2d');
                if (!ctx) throw new Error('Could not get canvas context');

                const scaleX = img.width / layer.width;
                const scaleY = img.height / layer.height;
                const localX = (x - layer.x) * scaleX;
                const localY = (y - layer.y) * scaleY;
                const localW = w * scaleX;
                const localH = h * scaleY;

                ctx.drawImage(
                    img,
                    Math.round(localX), Math.round(localY), Math.round(localW), Math.round(localH),
                    0, 0, finalW, finalH
                );

                const newSrc = cropCanvas.toDataURL();

                const nextLayers = imageLayers.map(l => l.id === activeLayerId ? {
                    ...l,
                    src: newSrc,
                    width: finalW,
                    height: finalH,
                    x: Math.round(x),
                    y: Math.round(y)
                } : l);

                setImageLayers(nextLayers);
                saveHistory(t('editor.history_crop_layer'), { settings, textLayers, imageLayers: nextLayers, view, src: currSrc });
                showToast(t('editor.crop_success'), 'success');
            } catch (err) {
                showToast(t('common.error'), 'error');
            }
            finally {
                setIsCropActive(false);
                setTool('move');
            }
        }
    };

    // -- Handler --
    const handlePointerDown = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const handle = target.getAttribute('data-handle');
        const textId = target.closest('[data-text-id]')?.getAttribute('data-text-id');
        const layerId = target.closest('[data-layer-id]')?.getAttribute('data-layer-id');

        e.stopPropagation();

        if (isCropActive && handle) {
            // ... (keep crop handler)
            actionRef.current = {
                type: 'crop',
                startX: e.clientX,
                startY: e.clientY,
                startCrop: { ...settings.crop },
                handle,
                startViewX: 0, startViewY: 0, startW: 0, startH: 0, targetId: null,
                startFontSize: 0
            };
        } else if (textId || layerId) {
            const tid = textId || layerId;
            const textLayer = textLayers.find(l => l.id === tid);
            const imageLayer = imageLayers.find(l => l.id === tid);
            const layer = textLayer || imageLayer;

            if (layer && tid) {
                setActiveLayerId(tid);
                const el = target.closest(textId ? `[data-text-id="${tid}"]` : `[data-layer-id="${tid}"]`) as HTMLElement;
                const rect = el ? el.getBoundingClientRect() : { width: 100 * view.scale, height: 40 * view.scale };
                actionRef.current = {
                    type: 'move_text',
                    startX: e.clientX,
                    startY: e.clientY,
                    startViewX: layer.x,
                    startViewY: layer.y,
                    handle: null,
                    startW: rect.width / view.scale,
                    startH: rect.height / view.scale,
                    startCrop: { x: 0, y: 0, w: 0, h: 0 },
                    targetId: tid,
                    startFontSize: (layer as any).fontSize || 0
                };
            }
        } else if (isCropActive) {
            const rect = canvasRef.current!.getBoundingClientRect();
            const canvasX = (e.clientX - rect.left) / view.scale;
            const canvasY = (e.clientY - rect.top) / view.scale;
            const { x, y, w, h } = settings.crop;
            if (canvasX >= x && canvasX <= x + w && canvasY >= y && canvasY <= y + h) {
                actionRef.current = {
                    type: 'move_crop',
                    startX: e.clientX,
                    startY: e.clientY,
                    startCrop: { ...settings.crop },
                    handle: null, startViewX: 0, startViewY: 0, startW: 0, startH: 0, targetId: null,
                    startFontSize: 0
                };
            }
        } else if (tool === 'resize' && handle) {
            const isBg = !activeLayerId || activeLayerId === 'bg';
            const tid = activeLayerId;
            const textLayer = textLayers.find(l => l.id === tid);
            const imageLayer = imageLayers.find(l => l.id === tid);

            let sW = 100, sH = 100;
            if (isBg) {
                sW = settings.width;
                sH = settings.height;
            } else if (imageLayer) {
                sW = imageLayer.width;
                sH = imageLayer.height;
            } else if (textLayer) {
                const el = document.querySelector(`[data-text-id="${tid}"]`);
                if (el) {
                    const r = el.getBoundingClientRect();
                    sW = r.width / view.scale;
                    sH = r.height / view.scale;
                } else {
                    sW = (textLayer.fontSize || 40) * 2;
                    sH = (textLayer.fontSize || 40);
                }
            }

            actionRef.current = {
                type: 'resize',
                startX: e.clientX,
                startY: e.clientY,
                startW: sW,
                startH: sH,
                handle,
                startViewX: isBg ? (settings.x || 0) : (imageLayer?.x ?? textLayer?.x ?? 0),
                startViewY: isBg ? (settings.y || 0) : (imageLayer?.y ?? textLayer?.y ?? 0),
                startCrop: { x: 0, y: 0, w: 0, h: 0 }, targetId: tid,
                startFontSize: textLayer?.fontSize || 0
            };
        } else if (e.button === 0 && !textId && !layerId && !handle) {
            // Left click on empty space selects bg
            setActiveLayerId('bg');
            if (tool === 'move' || e.shiftKey) {
                actionRef.current = {
                    type: 'pan',
                    startX: e.clientX,
                    startY: e.clientY,
                    startViewX: view.x,
                    startViewY: view.y,
                    handle: null, startW: 0, startH: 0, startCrop: { x: 0, y: 0, w: 0, h: 0 }, targetId: null,
                    startFontSize: 0
                };
            }
        } else if (e.button === 1) {
            e.preventDefault();
            actionRef.current = {
                type: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                startViewX: view.x,
                startViewY: view.y,
                handle: null, startW: 0, startH: 0, startCrop: { x: 0, y: 0, w: 0, h: 0 }, targetId: null,
                startFontSize: 0
            };
        }
    };

    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            if (!actionRef.current.type) return;
            const dx = e.clientX - actionRef.current.startX;
            const dy = e.clientY - actionRef.current.startY;
            const scale = view.scale;
            const isVertical = Math.abs(settings.rotation % 180) === 90;
            const canvasW = isVertical ? settings.height : settings.width;
            const canvasH = isVertical ? settings.width : settings.height;

            if (actionRef.current.type === 'pan') {
                setView(prev => ({
                    ...prev,
                    x: actionRef.current.startViewX + dx,
                    y: actionRef.current.startViewY + dy
                }));
            }
            else if (actionRef.current.type === 'move_crop') {
                const dWx = dx / scale;
                const dHy = dy / scale;
                let nx = actionRef.current.startCrop.x + dWx;
                let ny = actionRef.current.startCrop.y + dHy;
                const cw = actionRef.current.startCrop.w;
                const ch = actionRef.current.startCrop.h;

                const breakout = 25;
                const thresh = 10 / scale;
                const snapPointsX = [0, canvasW - cw];
                const snapPointsY = [0, canvasH - ch];
                textLayers.forEach((l: any) => {
                    snapPointsX.push(l.x, l.x + 100 - cw);
                    snapPointsY.push(l.y, l.y + 40 - ch);
                });

                const startX = actionRef.current.startCrop.x;
                const startY = actionRef.current.startCrop.y;

                snapPointsX.forEach(p => {
                    const isImmune = Math.abs(p - startX) < 0.1 && Math.abs(dx) < breakout;
                    if (Math.abs(nx - p) < thresh && !isImmune) nx = p;
                });
                snapPointsY.forEach(p => {
                    const isImmune = Math.abs(p - startY) < 0.1 && Math.abs(dy) < breakout;
                    if (Math.abs(ny - p) < thresh && !isImmune) ny = p;
                });

                setSettings(prev => ({
                    ...prev,
                    crop: { ...prev.crop, x: nx, y: ny }
                }));
            }
            else if (actionRef.current.type === 'move_text') {
                const tid = actionRef.current.targetId;
                let nx = actionRef.current.startViewX + dx / scale;
                let ny = actionRef.current.startViewY + dy / scale;
                const layerW = actionRef.current.startW;
                const layerH = actionRef.current.startH;

                const breakout = 25;
                const canvasCX = canvasW / 2;
                const canvasCY = canvasH / 2;
                const thresh = 8 / scale;
                let currentSnap: { x?: number, y?: number } | null = null;

                const sX = actionRef.current.startViewX;
                const sY = actionRef.current.startViewY;
                const isImmuneX = (p: number) => Math.abs(p - sX) < 0.1 && Math.abs(dx) < breakout;
                const isImmuneY = (p: number) => Math.abs(p - sY) < 0.1 && Math.abs(dy) < breakout;
                const isImmuneCX = (p: number) => Math.abs(p - (sX + layerW / 2)) < 0.1 && Math.abs(dx) < breakout;
                const isImmuneCY = (p: number) => Math.abs(p - (sY + layerH / 2)) < 0.1 && Math.abs(dy) < breakout;

                if (Math.abs(nx) < thresh && !isImmuneX(0)) { nx = 0; currentSnap = { x: 0 }; }
                else if (Math.abs((nx + layerW) - canvasW) < thresh && !isImmuneX(canvasW - layerW)) { nx = canvasW - layerW; currentSnap = { x: canvasW }; }
                else if (Math.abs((nx + layerW / 2) - canvasCX) < thresh && !isImmuneCX(canvasCX)) { nx = canvasCX - layerW / 2; currentSnap = { x: canvasCX }; }

                if (Math.abs(ny) < thresh && !isImmuneY(0)) { ny = 0; currentSnap = { ...currentSnap, y: 0 }; }
                else if (Math.abs((ny + layerH) - canvasH) < thresh && !isImmuneY(canvasH - layerH)) { ny = canvasH - layerH; currentSnap = { ...currentSnap, y: canvasH }; }
                else if (Math.abs((ny + layerH / 2) - canvasCY) < thresh && !isImmuneCY(canvasCY)) { ny = canvasCY - layerH / 2; currentSnap = { ...currentSnap, y: canvasCY }; }

                setSnapLines(currentSnap);
                setTextLayers(prev => prev.map((l: any) => l.id === tid ? { ...l, x: nx, y: ny } : l));
                setImageLayers(prev => prev.map((l: any) => l.id === tid ? { ...l, x: nx, y: ny } : l));
            }
            else if (actionRef.current.type === 'resize') {
                const canvasCX = canvasW / 2;
                const canvasCY = canvasH / 2;
                const dWx = dx / scale;
                const dHy = dy / scale;
                const h = actionRef.current.handle!;
                const tid = actionRef.current.targetId;
                const isCentered = e.shiftKey || e.ctrlKey;

                let newW = actionRef.current.startW;
                let newH = actionRef.current.startH;
                const ratio = actionRef.current.startW / actionRef.current.startH;

                if (h.includes('e')) newW = actionRef.current.startW + dWx;
                if (h.includes('w')) newW = actionRef.current.startW - dWx;
                if (h.includes('s')) newH = actionRef.current.startH + dHy;
                if (h.includes('n')) newH = actionRef.current.startH - dHy;

                const thresh = 7 / scale;
                const breakout = 20; // Ignore startsnap for 20px
                let currentSnap: { x?: number, y?: number } | null = null;

                const startX = actionRef.current.startViewX;
                const startY = actionRef.current.startViewY;
                const startW = actionRef.current.startW;
                const startH = actionRef.current.startH;
                const startEdgeX = h.includes('w') ? startX : (startX + startW);
                const startEdgeY = h.includes('n') ? startY : (startY + startH);

                // Helper to check immunity
                const isImmuneX = (p: number) => (Math.abs(p - startEdgeX) < 0.1) && (Math.abs(dx) < breakout);
                const isImmuneY = (p: number) => (Math.abs(p - startEdgeY) < 0.1) && (Math.abs(dy) < breakout);

                if (h.includes('e')) {
                    const edgeX = startX + newW;
                    if (Math.abs(edgeX - canvasW) < thresh && !isImmuneX(canvasW)) {
                        newW = canvasW - startX; currentSnap = { x: canvasW };
                    } else if (Math.abs(edgeX - canvasCX) < thresh && !isImmuneX(canvasCX)) {
                        newW = canvasCX - startX; currentSnap = { x: canvasCX };
                    }
                }
                if (h.includes('w')) {
                    const edgeX = startX + (startW - newW);
                    if (Math.abs(edgeX) < thresh && !isImmuneX(0)) {
                        newW = startX + startW; currentSnap = { ...currentSnap, x: 0 };
                    } else if (Math.abs(edgeX - canvasCX) < thresh && !isImmuneX(canvasCX)) {
                        newW = (startX + startW) - canvasCX; currentSnap = { ...currentSnap, x: canvasCX };
                    }
                }
                if (h.includes('s')) {
                    const edgeY = startY + newH;
                    if (Math.abs(edgeY - canvasH) < thresh && !isImmuneY(canvasH)) {
                        newH = canvasH - startY; currentSnap = { ...currentSnap, y: canvasH };
                    } else if (Math.abs(edgeY - canvasCY) < thresh && !isImmuneY(canvasCY)) {
                        newH = canvasCY - startY; currentSnap = { ...currentSnap, y: canvasCY };
                    }
                }
                if (h.includes('n')) {
                    const edgeY = startY + (startH - newH);
                    if (Math.abs(edgeY) < thresh && !isImmuneY(0)) {
                        newH = startY + startH; currentSnap = { ...currentSnap, y: 0 };
                    } else if (Math.abs(edgeY - canvasCY) < thresh && !isImmuneY(canvasCY)) {
                        newH = (startY + startH) - canvasCY; currentSnap = { ...currentSnap, y: canvasCY };
                    }
                }
                setSnapLines(currentSnap);

                let newX = actionRef.current.startViewX;
                let newY = actionRef.current.startViewY;

                if (isLocked) {
                    if (h === 'n' || h === 's') { newW = newH * ratio; }
                    else if (h === 'e' || h === 'w') { newH = newW / ratio; }
                    else {
                        if (currentSnap?.x !== undefined && currentSnap?.y === undefined) newH = newW / ratio;
                        else if (currentSnap?.y !== undefined && currentSnap?.x === undefined) newW = newH * ratio;
                        else if (Math.abs(dWx) > Math.abs(dHy)) newH = newW / ratio;
                        else newW = newH * ratio;
                    }
                }

                if (isCentered) {
                    newX = actionRef.current.startViewX + (actionRef.current.startW - newW) / 2;
                    newY = actionRef.current.startViewY + (actionRef.current.startH - newH) / 2;
                } else {
                    if (h.includes('w')) newX = actionRef.current.startViewX + (actionRef.current.startW - newW);
                    if (h.includes('n')) newY = actionRef.current.startViewY + (actionRef.current.startH - newH);
                }

                newW = Math.max(10, newW);
                newH = Math.max(10, newH);

                if (!tid || tid === 'bg') {
                    setSettings(prev => ({ ...prev, width: newW, height: newH, x: newX, y: newY }));
                } else if (textLayers.find((l: any) => l.id === tid)) {
                    const sH = actionRef.current.startH;
                    const sW = actionRef.current.startW;
                    let scaleFactor = 1;
                    if (h === 'n' || h === 's') scaleFactor = newH / sH;
                    else if (h === 'e' || h === 'w') scaleFactor = newW / sW;
                    else scaleFactor = Math.max(newW / sW, newH / sH);

                    const actualW = sW * scaleFactor;
                    const actualH = sH * scaleFactor;

                    let finalX = actionRef.current.startViewX;
                    let finalY = actionRef.current.startViewY;
                    if (isCentered) {
                        finalX += (sW - actualW) / 2;
                        finalY += (sH - actualH) / 2;
                    } else {
                        if (h.includes('w')) finalX += (sW - actualW);
                        if (h.includes('n')) finalY += (sH - actualH);
                    }

                    setTextLayers(prev => prev.map((l: any) => l.id === tid ? {
                        ...l,
                        fontSize: Math.max(8, (actionRef.current.startFontSize || l.fontSize || 40) * scaleFactor),
                        x: finalX, y: finalY
                    } : l));
                } else if (imageLayers.find((l: any) => l.id === tid)) {
                    setImageLayers(prev => prev.map((l: any) => l.id === tid ? { ...l, width: newW, height: newH, x: newX, y: newY } : l));
                }
            }
            else if (actionRef.current.type === 'crop') {
                const dWx = dx / scale;
                const dHy = dy / scale;
                const h = actionRef.current.handle!;
                let { x, y, w, h: ch } = actionRef.current.startCrop;
                const isCentered = e.shiftKey || e.ctrlKey;
                let nw = w, nch = ch;
                let nx = x, ny = y;

                if (isCentered) {
                    const centerX = x + w / 2;
                    const centerY = y + ch / 2;
                    if (h.includes('e')) nw = w + 2 * dWx;
                    else if (h.includes('w')) nw = w - 2 * dWx;
                    if (h.includes('s')) nch = ch + 2 * dHy;
                    else if (h.includes('n')) nch = ch - 2 * dHy;
                    if (cropAspect) {
                        if (['n', 's'].includes(h) && !['e', 'w'].includes(h)) nw = nch * cropAspect;
                        else if (['e', 'w'].includes(h) && !['n', 's'].includes(h)) nch = nw / cropAspect;
                        else {
                            if (Math.abs(dWx) > Math.abs(dHy)) nch = nw / cropAspect;
                            else nw = nch * cropAspect;
                        }
                    }
                    nw = Math.max(10, nw);
                    nch = Math.max(10, nch);
                    nx = centerX - nw / 2;
                    ny = centerY - nch / 2;
                } else {
                    if (h.includes('e')) nw = w + dWx;
                    if (h.includes('w')) { nw = w - dWx; nx = x + dWx; }
                    if (h.includes('s')) nch = ch + dHy;
                    if (h.includes('n')) { nch = ch - dHy; ny = y + dHy; }
                    if (cropAspect) {
                        if (h === 'n' || h === 's') nw = nch * cropAspect;
                        else if (h === 'e' || h === 'w') nch = nw / cropAspect;
                        else {
                            if (Math.abs(dWx) > Math.abs(dHy)) nch = nw / cropAspect;
                            else nw = nch * cropAspect;
                        }
                        if (h.includes('w')) nx = actionRef.current.startCrop.x + (actionRef.current.startCrop.w - nw);
                        if (h.includes('n')) ny = actionRef.current.startCrop.y + (actionRef.current.startCrop.h - nch);
                    }
                    nw = Math.max(10, nw);
                    nch = Math.max(10, nch);
                }

                const target = activeLayerId && activeLayerId !== 'bg' ? imageLayers.find(l => l.id === activeLayerId) : null;
                const minX = target ? target.x : 0;
                const minY = target ? target.y : 0;
                const maxX = target ? target.x + target.width : canvasW;
                const maxY = target ? target.y + target.height : canvasH;

                if (!cropAspect) {
                    const thresh = 10 / scale;
                    const breakout = 25;
                    const isImmuneX = (p: number) => Math.abs(p - actionRef.current.startCrop.x) < 0.1 && Math.abs(dx) < breakout;
                    const isImmuneY = (p: number) => Math.abs(p - actionRef.current.startCrop.y) < 0.1 && Math.abs(dy) < breakout;
                    const isImmuneEX = (p: number) => Math.abs(p - (actionRef.current.startCrop.x + actionRef.current.startCrop.w)) < 0.1 && Math.abs(dx) < breakout;
                    const isImmuneSY = (p: number) => Math.abs(p - (actionRef.current.startCrop.y + actionRef.current.startCrop.h)) < 0.1 && Math.abs(dy) < breakout;

                    if (isCentered) {
                        if (Math.abs(nx - minX) < thresh && !isImmuneX(minX)) { nw += (nx - minX) * 2; nx = minX; }
                        if (Math.abs(nx + nw - maxX) < thresh && !isImmuneEX(maxX)) { nw = (maxX - nx); nx = (x + w / 2) - nw / 2; }
                        if (Math.abs(ny - minY) < thresh && !isImmuneY(minY)) { nch += (ny - minY) * 2; ny = minY; }
                        if (Math.abs(ny + nch - maxY) < thresh && !isImmuneSY(maxY)) { nch = (maxY - ny); ny = (y + ch / 2) - nch / 2; }
                    } else {
                        if (h.includes('w') && Math.abs(nx - minX) < thresh && !isImmuneX(minX)) { nw += (nx - minX); nx = minX; }
                        if (h.includes('e') && Math.abs(nx + nw - maxX) < thresh && !isImmuneEX(maxX)) { nw = (maxX - nx); }
                        if (h.includes('n') && Math.abs(ny - minY) < thresh && !isImmuneY(minY)) { nch += (ny - minY); ny = minY; }
                        if (h.includes('s') && Math.abs(ny + nch - maxY) < thresh && !isImmuneSY(maxY)) { nch = (maxY - ny); }
                    }
                }

                setSettings(prev => ({
                    ...prev,
                    crop: {
                        x: Math.max(minX, Math.min(nx, maxX - 10)),
                        y: Math.max(minY, Math.min(ny, maxY - 10)),
                        w: Math.max(10, Math.min(nw, maxX - nx)),
                        h: Math.max(10, Math.min(nch, maxY - ny))
                    }
                }));
            }
        };

        const handleUp = () => {
            setSnapLines(null);
            if (actionRef.current.type && actionRef.current.type !== 'pan') {
                if (actionRef.current.type !== 'crop' && actionRef.current.type !== 'move_crop') {
                    saveHistory(actionRef.current.type === 'resize' ? t('editor.history_resize') : t('editor.history_move'));
                }
            }
            actionRef.current.type = null;
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
        };
    }, [view.scale, isLocked, cropAspect, settings.rotation, settings.width, settings.height, textLayers, imageLayers, activeLayerId]);

    // -- Font Loading --
    const GOOGLE_FONTS = [
        'Inter', 'Roboto', 'Montserrat', 'Open Sans', 'Lato', 'Poppins', 'Ubuntu', 'Oswald', 'Raleway',
        'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Dancing Script', 'Pacifico',
        'Caveat', 'Satisfy', 'Great Vibes', 'Permanent Marker', 'Lobster', 'Righteous', 'Fredoka One',
        'Abel', 'Anton', 'Bebas Neue', 'Exo 2', 'Cinzel', 'Quicksand', 'Josefin Sans',
        'Fira Code', 'Roboto Mono', 'Source Code Pro', 'VT323'
    ];

    useEffect(() => {
        const uniqueFonts = [...new Set(textLayers.map(l => l.fontFamily).filter(f => f && GOOGLE_FONTS.includes(f)))];
        // Pre-load popular fonts for preview and common usage
        const commonFonts = ['Dancing Script', 'Pacifico', 'Lobster', 'Great Vibes', 'Satisfy', 'Exo 2', 'Montserrat', 'Poppins'];
        const allToLoad = [...new Set([...uniqueFonts, ...commonFonts])];

        allToLoad.forEach(font => {
            if (!font) return;
            const fontId = `google-font-${font.replace(/\s+/g, '-').toLowerCase()}`;
            if (!document.getElementById(fontId)) {
                const link = document.createElement('link');
                link.id = fontId;
                link.rel = 'stylesheet';
                // Encode space as + and add latin-ext subset for Turkish support
                const fontQuery = font.replace(/\s+/g, '+');
                link.href = `https://fonts.googleapis.com/css2?family=${fontQuery}:wght@100;300;400;500;600;700;800;900&display=latin-ext&swap`;
                document.head.appendChild(link);
            }
        });
    }, [textLayers]);

    const addTextLayer = () => {
        const id = Math.random().toString(36).substr(2, 9);
        const isVertical = Math.abs(settings.rotation % 180) === 90;
        const cx = (isVertical ? settings.height : settings.width) / 2;
        const cy = (isVertical ? settings.width : settings.height) / 2;

        const newLayer: TextLayer = {
            id,
            text: 'Editing Text',
            x: cx - 100, y: cy - 20,
            fontSize: 40, color: '#ffffff', rotation: 0,
            fontFamily: 'Inter', fontWeight: 'bold',
            brightness: 0, contrast: 0, saturation: 0, exposure: 0, sepia: 0, hue: 0,
            dehaze: 0,
            opacity: 1, blur: 0, blendMode: 'normal', letterSpacing: 0,
            flipH: false, flipV: false
        };
        const nextLayers = [...textLayers, newLayer];
        saveHistory(t('editor.add_text'), { settings, textLayers: nextLayers, imageLayers, view, src: currSrc });
        setTextLayers(nextLayers);
        setActiveLayerId(id);
    };

    const addImageLayer = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            });

            if (selected) {
                const path = typeof selected === 'string' ? selected : (selected as any).path;
                const src = convertFileSrc(path);

                const img = new Image();
                img.src = src;
                img.onload = () => {
                    const isVertical = Math.abs(settings.rotation % 180) === 90;
                    const canvasW = isVertical ? settings.height : settings.width;
                    const canvasH = isVertical ? settings.width : settings.height;

                    // Scale to fit the canvas (max 100% of original size)
                    const ratio = Math.min(canvasW / img.width, canvasH / img.height, 1.0);
                    const w = img.width * ratio;
                    const h = img.height * ratio;

                    const newLayer: ImageLayer = {
                        id: Math.random().toString(36).substr(2, 9),
                        src,
                        path,
                        x: (canvasW - w) / 2,
                        y: (canvasH - h) / 2,
                        width: w,
                        height: h,
                        rotation: 0,
                        flipH: false,
                        flipV: false,
                        opacity: 1,
                        blur: 0,
                        brightness: 0,
                        contrast: 0,
                        saturation: 0,
                        exposure: 0,
                        sepia: 0,
                        hue: 0,
                        dehaze: 0,
                        blendMode: 'normal'
                    };

                    const nextLayers = [...imageLayers, newLayer];
                    setImageLayers(nextLayers);
                    setActiveLayerId(newLayer.id);
                    saveHistory(t('editor.add_image_layer'), {
                        settings, textLayers, imageLayers: nextLayers, view, src: currSrc
                    });
                };
            }
        } catch (error) {
            showToast(t('toast.pick_image_error'), 'error');
        }
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const direction = e.deltaY > 0 ? -1 : 1;
            const zoomDelta = direction * 0.1;

            setView(prev => {
                const newScale = Math.min(Math.max(0.05, prev.scale * (1 + zoomDelta)), 50);
                const scaleRatio = newScale / prev.scale;
                const newX = mouseX - (mouseX - prev.x) * scaleRatio;
                const newY = mouseY - (mouseY - prev.y) * scaleRatio;
                return { scale: newScale, x: newX, y: newY };
            });
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, [containerRef.current]); // Container depends on ref being set

    const performSave = async () => {
        if (!canvasRef.current) return;
        setIsSaving(true);
        try {
            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = canvasRef.current.width;
            compositeCanvas.height = canvasRef.current.height;
            const ctx = compositeCanvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;

            // 1. Draw Background
            ctx.filter = settings.blur > 0 ? `blur(${settings.blur}px)` : 'none';
            ctx.globalAlpha = settings.opacity ?? 1;
            ctx.drawImage(canvasRef.current, 0, 0);
            ctx.filter = 'none';
            ctx.globalAlpha = 1;

            // 2. Draw Image Layers
            for (const l of imageLayers) {
                ctx.save();
                ctx.translate(l.x, l.y);
                ctx.rotate((l.rotation * Math.PI) / 180);

                if (l.flipH || l.flipV) {
                    ctx.scale(l.flipH ? -1 : 1, l.flipV ? -1 : 1);
                }

                ctx.globalAlpha = l.opacity ?? 1;
                ctx.globalCompositeOperation = (l.blendMode as any) || 'source-over';

                const filters = [];
                filters.push(`brightness(${((l.brightness || 0) * 0.5 + 1.0) * Math.pow(2.0, l.exposure || 0)})`);
                // Note: SVG filters can sometimes cause toDataURL to fail in some webviews.
                // We'll try to apply them but wrap in try-catch if needed or use a fallback.
                try {
                    filters.push(`url(#filter-ext-${l.id})`);
                } catch (e) { /* ignore */ }

                if ((l.sepia ?? 0) !== 0) filters.push(`sepia(${l.sepia || 0})`);
                if ((l.saturation ?? 0) !== 0 || (l.vibrance ?? 0) !== 0) filters.push(`saturate(${(l.saturation || 0) + 1.0 + (l.vibrance || 0) * 0.5})`);
                if ((l.hue ?? 0) !== 0) filters.push(`hue-rotate(${(l.hue ?? 0) * 180}deg)`);
                if (l.blur && l.blur > 0) filters.push(`blur(${l.blur}px)`);

                if (filters.length > 0) ctx.filter = filters.join(' ');

                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = l.src;

                await new Promise((res, rej) => {
                    if (img.complete && img.naturalWidth) res(null);
                    else {
                        img.onload = () => res(null);
                        img.onerror = () => rej(new Error(`Failed to load layer: ${l.id}`));
                    }
                });

                // Offset drawing if flipped
                ctx.drawImage(img, l.flipH ? -l.width : 0, l.flipV ? -l.height : 0, l.width, l.height);
                ctx.restore();
            }

            // 3. Draw Text Layers
            textLayers.forEach(l => {
                ctx.save();
                ctx.translate(l.x, l.y);
                ctx.rotate((l.rotation * Math.PI) / 180);

                if (l.flipH || l.flipV) {
                    ctx.scale(l.flipH ? -1 : 1, l.flipV ? -1 : 1);
                }

                ctx.globalAlpha = l.opacity ?? 1;
                ctx.globalCompositeOperation = (l.blendMode as any) || 'source-over';
                if (l.blur && l.blur > 0) ctx.filter = `blur(${l.blur}px)`;

                ctx.font = `${l.fontWeight || 'normal'} ${l.fontSize}px "${l.fontFamily || 'Inter'}", sans-serif`;
                ctx.fillStyle = l.color;
                ctx.textBaseline = 'top';
                ctx.fillText(l.text, l.flipH ? -200 : 0, 0); // approx offset for flipped text
                ctx.restore();
            });

            const mime = saveFormat === 'png' ? 'image/png' : 'image/jpeg';
            let dataUrl = '';
            try {
                dataUrl = compositeCanvas.toDataURL(mime, 0.92);
            } catch (canvasErr) {
                // Fallback: Clear and redraw without SVG filters if that was the cause
                // (Omitted for brevity, but we'll at least throw a better error)
                throw canvasErr;
            }

            const separator = savePath.includes('\\') ? '\\' : '/';
            const finalDir = (savePath.endsWith('/') || savePath.endsWith('\\')) ? savePath : savePath + separator;
            const newPath = `${finalDir}${saveName}.${saveFormat}`;

            await invoke('save_image', { path: newPath, dataUrl, galleryRoot });
            lastSavedNameRef.current = saveName;
            const newFilename = `${saveName}.${saveFormat}`;
            setDisplayFilename(newFilename);
            showToast(t('editor.save_success'), 'success');
            onSaveSuccess({ ...file, path: newPath, filename: newFilename, mtime: Date.now() });
            setShowSaveModal(false);
        } catch (e) {
            showToast(t('editor.save_error'), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const lastSavedNameRef = useRef<string>('');

    const handleSelectFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                defaultPath: savePath || undefined
            });
            if (selected && typeof selected === 'string') {
                setSavePath(selected);
            }
        } catch (err) {
        }
    };

    const handleSave = () => {
        if (lastSavedNameRef.current) {
            setSaveName(lastSavedNameRef.current);
        } else {
            const lastDot = file.filename.lastIndexOf('.');
            const baseName = lastDot !== -1 ? file.filename.substring(0, lastDot) : file.filename;
            setSaveName(baseName);
        }

        // Initialize savePath with current file's directory
        const lastSlash = Math.max(file.path.lastIndexOf('\\'), file.path.lastIndexOf('/'));
        const dir = lastSlash !== -1 ? file.path.substring(0, lastSlash) : '';
        setSavePath(dir);

        setSaveFormat(file.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg');
        setShowSaveModal(true);
    };

    const isVertical = Math.abs(settings.rotation % 180) === 90;
    const canvasW = isVertical ? settings.height : settings.width;
    const canvasH = isVertical ? settings.width : settings.height;

    return (
        <div className="image-editor-container">

            {/* Toolbar */}
            <div className="toolbar">
                <div className="toolbar-left">
                    <div className="editor-logo">
                        <Palette size={20} />
                    </div>
                    <div className="toolbar-file-info">
                        <span className="toolbar-filename">{displayFilename}</span>
                        <span className="toolbar-filepath">{file.path}</span>
                    </div>
                </div>

                <div className="toolbar-center">
                    <div className="toolbar-tools">
                        {[
                            { id: 'move', icon: MousePointer2, label: `${t('editor.tool_move')} (V)` },
                            { id: 'resize', icon: Move, label: `${t('editor.tool_resize')} (T)` },
                            { id: 'crop', icon: Crop, label: `${t('editor.tool_crop')} (C)` },
                            { id: 'image', icon: ImageIcon, label: t('editor.tool_image') },
                            { id: 'text', icon: Type, label: t('editor.tool_text') },
                        ].map((tItem) => (
                            <Tooltip key={tItem.id} text={tItem.label}>
                                <button
                                    onClick={() => {
                                        if (tItem.id === 'text') {
                                            addTextLayer();
                                        } else if (tItem.id === 'image') {
                                            addImageLayer();
                                        } else {
                                            setTool(tItem.id as any);
                                            if (tItem.id === 'crop') {
                                                setIsCropActive(true);
                                                const target = activeLayerId && activeLayerId !== 'bg' ? imageLayers.find(l => l.id === activeLayerId) : null;
                                                if (target) {
                                                    setSettings(s => ({ ...s, crop: { x: target.x, y: target.y, w: target.width, h: target.height } }));
                                                } else {
                                                    setSettings(s => ({ ...s, crop: { x: 0, y: 0, w: canvasW, h: canvasH } }));
                                                }
                                            } else {
                                                setIsCropActive(false);
                                            }
                                        }
                                    }}
                                    disabled={tItem.id === 'crop' && textLayers.some(l => l.id === activeLayerId)}
                                    className={`btn-icon ${tool === tItem.id ? 'active' : ''}`}
                                >
                                    <tItem.icon size={18} />
                                </button>
                            </Tooltip>
                        ))}

                        <div className="panel-divider-v" />

                        <Tooltip text={`${t('editor.undo')} (Ctrl+Z)`}>
                            <button
                                onClick={handleUndo}
                                disabled={undoStack.length === 0}
                                className="btn-icon"
                                style={{ opacity: undoStack.length > 0 ? 1 : 0.5, cursor: undoStack.length > 0 ? 'pointer' : 'default' }}
                            >
                                <Undo2 size={18} />
                            </button>
                        </Tooltip>
                        <Tooltip text={`${t('editor.redo')} (Ctrl+Y)`}>
                            <button
                                onClick={handleRedo}
                                disabled={redoStack.length === 0}
                                className="btn-icon"
                                style={{ opacity: redoStack.length > 0 ? 1 : 0.5, cursor: redoStack.length > 0 ? 'pointer' : 'default' }}
                            >
                                <Redo2 size={18} />
                            </button>
                        </Tooltip>

                        <div className="panel-divider-v" />

                        <Tooltip text={t('editor.reset_layout')}>
                            <button onClick={handleResetLayout} className="btn-icon">
                                <LayoutTemplate size={18} />
                            </button>
                        </Tooltip>
                    </div>

                    {isCropActive && (
                        <div className="crop-options">
                            {[
                                { label: t('editor.free'), value: null },
                                { label: '1:1', value: 1 },
                                { label: '4:3', value: 4 / 3 },
                                { label: '16:9', value: 16 / 9 },
                                { label: '3:2', value: 3 / 2 }
                            ].map(asp => (
                                <button
                                    key={asp.label}
                                    onClick={() => {
                                        setCropAspect(asp.value);
                                        if (asp.value) {
                                            setSettings(s => {
                                                const isImgVertical = canvasH > canvasW;
                                                let nw, nch;

                                                if (isImgVertical) {
                                                    // Portrait photo: keep width if possible
                                                    nw = s.crop.w;
                                                    nch = nw / asp.value;
                                                    if (nch > canvasH) {
                                                        nch = canvasH;
                                                        nw = nch * asp.value;
                                                    }
                                                } else {
                                                    // Landscape photo: keep height if possible
                                                    nch = s.crop.h;
                                                    nw = nch * asp.value;
                                                    if (nw > canvasW) {
                                                        nw = canvasW;
                                                        nch = nw / asp.value;
                                                    }
                                                }

                                                return {
                                                    ...s,
                                                    crop: {
                                                        ...s.crop,
                                                        x: (canvasW - nw) / 2,
                                                        y: (canvasH - nch) / 2,
                                                        w: nw,
                                                        h: nch
                                                    }
                                                };
                                            });
                                        }
                                    }}
                                    className={`crop-aspect-btn ${cropAspect === asp.value || (asp.value && cropAspect && Math.abs(cropAspect - 1 / asp.value) < 0.01) ? 'active' : ''}`}
                                >
                                    {asp.label}
                                </button>
                            ))}
                            {cropAspect && cropAspect !== 1 && (
                                <button
                                    onClick={() => {
                                        const next = 1 / cropAspect;
                                        setCropAspect(next);
                                        setSettings(s => {
                                            const isImgVertical = canvasH > canvasW;
                                            let nw, nch;

                                            if (isImgVertical) {
                                                // Vertical image: try to keep width fixed
                                                nw = s.crop.w;
                                                nch = nw / next;
                                                if (nch > canvasH) {
                                                    nch = canvasH;
                                                    nw = nch * next;
                                                }
                                            } else {
                                                // Horizontal image: try to keep height fixed
                                                nch = s.crop.h;
                                                nw = nch * next;
                                                if (nw > canvasW) {
                                                    nw = canvasW;
                                                    nch = nw / next;
                                                }
                                            }

                                            return {
                                                ...s,
                                                crop: {
                                                    ...s.crop,
                                                    x: (canvasW - nw) / 2,
                                                    y: (canvasH - nch) / 2,
                                                    w: nw,
                                                    h: nch
                                                }
                                            };
                                        });
                                    }}
                                    className="btn-icon"
                                    style={{ width: '24px', height: '24px', color: '#3b82f6' }}
                                >
                                    <ArrowLeftRight size={14} />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="toolbar-right">
                    <Tooltip text={t('editor.save')}>
                        <button onClick={handleSave} className="ie-save-btn">
                            <Save size={16} />
                            <span>{t('editor.save')}</span>
                        </button>
                    </Tooltip>
                    <Tooltip text={t('common.close')}>
                        <button className="btn-icon" onClick={onClose}><X size={20} /></button>
                    </Tooltip>
                </div>
            </div>

            {/* Viewport */}
            <div
                ref={containerRef}
                onPointerDown={handlePointerDown}
                className="editor-workspace"
            >
                <div
                    style={{
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        transformOrigin: '0 0', position: 'absolute', top: 0, left: 0
                    }}
                >
                    <div
                        className="canvas-container"
                        style={{ width: canvasW, height: canvasH, left: settings.x || 0, top: settings.y || 0 }}
                    >
                        {/* Snap Lines */}
                        {snapLines?.x !== undefined && (
                            <div className="snap-line-v" style={{ left: snapLines.x }} />
                        )}
                        {snapLines?.y !== undefined && (
                            <div className="snap-line-h" style={{ top: snapLines.y }} />
                        )}

                        <canvas
                            ref={canvasRef}
                            style={{
                                width: '100%', height: '100%', display: 'block',
                                filter: `blur(${settings.blur || 0}px)`,
                                opacity: settings.opacity ?? 1
                            }}
                        />

                        {/* Image Layers */}
                        {imageLayers.map(l => (
                            <div
                                key={l.id} data-layer-id={l.id}
                                style={{
                                    position: 'absolute', left: l.x, top: l.y,
                                    width: l.width, height: l.height,
                                    border: activeLayerId === l.id ? '1px dashed #3b82f6' : '1px solid transparent',
                                    cursor: 'move', userSelect: 'none',
                                    transform: `rotate(${l.rotation}deg) scale(${l.flipH ? -1 : 1}, ${l.flipV ? -1 : 1})`,
                                    opacity: l.opacity ?? 1,
                                    mixBlendMode: (l.blendMode as any) || 'normal'
                                }}
                            >
                                {/* SVG Filter Definition */}
                                <svg width="0" height="0" style={{ position: 'absolute' }}>
                                    <defs>
                                        <filter id={`filter-ext-${l.id}`} colorInterpolationFilters="sRGB">
                                            {/* 1. Temp & Tint bias + Color Balance (Additive) */}
                                            <feColorMatrix type="matrix" values={`
                                                1 0 0 0 ${(l.temp || 0) * 0.15 - (l.tint || 0) * 0.04 + (l.shR || 0) + (l.midR || 0) + (l.hiR || 0)}
                                                0 1 0 0 ${(l.tint || 0) * 0.08 + (l.shG || 0) + (l.midG || 0) + (l.hiG || 0)}
                                                0 0 1 0 ${-(l.temp || 0) * 0.15 - (l.tint || 0) * 0.04 + (l.shB || 0) + (l.midB || 0) + (l.hiB || 0)}
                                                0 0 0 1 0
                                            `} />
                                            {/* 2. Contrast: val = x * k + (0.5 - 0.5*k) */}
                                            <feComponentTransfer>
                                                <feFuncR type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                                <feFuncG type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                                <feFuncB type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                            </feComponentTransfer>
                                            {/* 3. Gamma + Dehaze Gamma */}
                                            <feComponentTransfer>
                                                <feFuncR type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                                <feFuncG type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                                <feFuncB type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                            </feComponentTransfer>
                                            {/* 3b. Dehaze Black Point */}
                                            {(l.dehaze || 0) !== 0 && (
                                                <feComponentTransfer>
                                                    <feFuncR type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                    <feFuncG type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                    <feFuncB type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                </feComponentTransfer>
                                            )}
                                            {/* 4. Clarity (Sharpen Matrix) */}
                                            {(l.clarity || 0) !== 0 && (
                                                <feConvolveMatrix order="3" kernelMatrix={`0 ${-(l.clarity || 0)} 0 ${-(l.clarity || 0)} ${1 + 4 * (l.clarity || 0)} ${-(l.clarity || 0)} 0 ${-(l.clarity || 0)} 0`} />
                                            )}
                                        </filter>
                                    </defs>
                                </svg>
                                <img
                                    src={l.src}
                                    style={{
                                        width: '100%', height: '100%', display: 'block', pointerEvents: 'none',
                                        filter: `
                                            brightness(${((l.brightness || 0) * 0.5 + 1.0) * Math.pow(2.0, l.exposure || 0)}) 
                                            url(#filter-ext-${l.id})
                                            sepia(${l.sepia || 0}) 
                                            saturate(${(l.saturation || 0) + 1.0 + (l.vibrance || 0) * 0.5 + (l.dehaze || 0) * 0.2}) 
                                            hue-rotate(${(l.hue || 0) * 180}deg) 
                                            blur(${l.blur || 0}px)
                                        `
                                    }}
                                    alt=""
                                />
                            </div>
                        ))}

                        {/* Text Layers */}
                        {textLayers.map(l => (
                            <div
                                key={l.id} data-text-id={l.id}
                                style={{
                                    position: 'absolute', left: l.x, top: l.y,
                                    fontSize: l.fontSize, color: l.color,
                                    border: activeLayerId === l.id ? '1px dashed #3b82f6' : '1px solid transparent',
                                    cursor: 'move', userSelect: 'none', whiteSpace: 'nowrap',
                                    transform: `rotate(${l.rotation}deg) scale(${l.flipH ? -1 : 1}, ${l.flipV ? -1 : 1})`,
                                    fontFamily: l.fontFamily || 'Inter, sans-serif',
                                    fontWeight: l.fontWeight || 'normal',
                                    opacity: l.opacity ?? 1,
                                    mixBlendMode: (l.blendMode as any) || 'normal',
                                    letterSpacing: `${l.letterSpacing || 0}px`,
                                    filter: `
                                        brightness(${((l.brightness || 0) * 0.5 + 1.0) * Math.pow(2.0, l.exposure || 0)}) 
                                        url(#filter-text-ext-${l.id})
                                        sepia(${l.sepia || 0}) 
                                        saturate(${(l.saturation || 0) + 1.0 + (l.vibrance || 0) * 0.5 + (l.dehaze || 0) * 0.2}) 
                                        hue-rotate(${(l.hue || 0) * 180}deg) 
                                        blur(${l.blur || 0}px)
                                    `
                                }}
                            >
                                <svg width="0" height="0" style={{ position: 'absolute' }}>
                                    <defs>
                                        <filter id={`filter-text-ext-${l.id}`} colorInterpolationFilters="sRGB">
                                            <feComponentTransfer>
                                                <feFuncR type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                                <feFuncG type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                                <feFuncB type="gamma" exponent={Math.pow(2.0, -(l.gamma || 0) * 1.2 + (l.dehaze || 0) * 0.2)} />
                                            </feComponentTransfer>
                                            {(l.dehaze || 0) !== 0 && (
                                                <feComponentTransfer>
                                                    <feFuncR type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                    <feFuncG type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                    <feFuncB type="linear" slope={1.0 / (1.0 - Math.abs(l.dehaze || 0) * 0.1)} intercept={-(l.dehaze || 0) * 0.05} />
                                                </feComponentTransfer>
                                            )}
                                            <feColorMatrix type="matrix" values={`
                                                1 0 0 0 ${(l.temp || 0) * 0.15 - (l.tint || 0) * 0.04 + (l.shR || 0) + (l.midR || 0) + (l.hiR || 0)}
                                                0 1 0 0 ${(l.tint || 0) * 0.08 + (l.shG || 0) + (l.midG || 0) + (l.hiG || 0)}
                                                0 0 1 0 ${-(l.temp || 0) * 0.15 - (l.tint || 0) * 0.04 + (l.shB || 0) + (l.midB || 0) + (l.hiB || 0)}
                                                0 0 0 1 0
                                            `} />
                                            <feComponentTransfer>
                                                <feFuncR type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                                <feFuncG type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                                <feFuncB type="linear" slope={(l.contrast || 0) * 0.7 + 1.0} intercept={0.5 * (1.0 - ((l.contrast || 0) * 0.7 + 1.0))} />
                                            </feComponentTransfer>
                                            {(l.clarity || 0) !== 0 && (
                                                <feConvolveMatrix order="3" kernelMatrix={`0 ${-(l.clarity || 0)} 0 ${-(l.clarity || 0)} ${1 + 4 * (l.clarity || 0)} ${-(l.clarity || 0)} 0 ${-(l.clarity || 0)} 0`} />
                                            )}
                                        </filter>
                                    </defs>
                                </svg>
                                <span style={{ filter: `url(#filter-text-ext-${l.id})` }}>
                                    {l.text}
                                </span>
                            </div>
                        ))}

                        {/* Handlers */}
                        {tool === 'resize' && !isCropActive && (
                            <div className="resize-overlay" style={(() => {
                                const baseStyle = activeLayerId && activeLayerId !== 'bg' ? (() => {
                                    const layer = [...textLayers, ...imageLayers].find(l => l.id === activeLayerId);
                                    if (!layer) return {};
                                    let w = (layer as any).width || 100;
                                    let h = (layer as any).height || 40;

                                    // Live measure for text using offsetSize (stable under CSS scale)
                                    if (!('width' in layer)) {
                                        const el = document.querySelector(`[data-text-id="${layer.id}"]`) as HTMLElement;
                                        if (el) {
                                            w = el.offsetWidth;
                                            h = el.offsetHeight;
                                        }
                                    }

                                    return {
                                        position: 'absolute',
                                        left: layer.x, top: layer.y,
                                        width: w,
                                        height: h,
                                        pointerEvents: 'none'
                                    };
                                })() : { width: '100%', height: '100%', top: 0, left: 0 } as any;

                                return {
                                    ...baseStyle,
                                    borderWidth: `${1 / view.scale}px`
                                };
                            })()}>
                                {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(p => {
                                    return (
                                        <div key={p} data-handle={p} className="resize-handle" style={{
                                            cursor: `${p}-resize`, pointerEvents: 'auto',
                                            width: `${10 / view.scale}px`,
                                            height: `${10 / view.scale}px`,
                                            top: p.includes('n') ? 0 : (p.includes('s') ? '100%' : '50%'),
                                            left: p.includes('w') ? 0 : (p.includes('e') ? '100%' : '50%'),
                                            transform: 'translate(-50%, -50%)',
                                            borderWidth: `${1 / view.scale}px`,
                                            borderRadius: `${2 / view.scale}px`,
                                            zIndex: 2
                                        }} onPointerDown={handlePointerDown} />
                                    );
                                })}

                                {(() => {
                                    const layer = activeLayerId && activeLayerId !== 'bg' ? [...textLayers, ...imageLayers].find(l => l.id === activeLayerId) : null;
                                    let w = layer ? (layer as any).width || 100 : settings.width;
                                    let h = layer ? (layer as any).height || 40 : settings.height;

                                    if (layer && !('width' in layer)) {
                                        const el = document.querySelector(`[data-text-id="${layer.id}"]`) as HTMLElement;
                                        if (el) {
                                            w = el.offsetWidth;
                                            h = el.offsetHeight;
                                        }
                                    }

                                    return (
                                        <div className="ie-dims-badge scale" style={{
                                            top: -30 / view.scale,
                                            fontSize: `${11 / view.scale}px`,
                                            padding: `${3 / view.scale}px ${10 / view.scale}px`,
                                            borderRadius: `${6 / view.scale}px`,
                                            borderWidth: `${1 / view.scale}px`
                                        }}>
                                            {Math.round(w)} × {Math.round(h)}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* Crop Overlay */}
                        {isCropActive && (
                            <>
                                <div className="crop-overlay-bg" />
                                <div className="crop-box" style={{
                                    left: settings.crop.x, top: settings.crop.y, width: settings.crop.w, height: settings.crop.h,
                                    borderWidth: `${2 / view.scale}px`
                                }}>
                                    <div className="ie-crop-grid-h" />
                                    <div className="ie-crop-grid-v" />

                                    {/* Pixel Dimensions Badge - Counter-scaled to stay legible */}
                                    <div className="ie-dims-badge crop" style={{
                                        top: -30 / view.scale,
                                        fontSize: `${11 / view.scale}px`,
                                        padding: `${3 / view.scale}px ${10 / view.scale}px`,
                                        borderRadius: `${6 / view.scale}px`,
                                        borderWidth: `${1 / view.scale}px`
                                    }}>
                                        {Math.round(settings.crop.w)} × {Math.round(settings.crop.h)}
                                    </div>

                                    {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(p => (
                                        <div key={p} data-handle={p} className={`crop-handle ${p}`} style={{
                                            width: (p === 'n' || p === 's') ? '40%' : `${8 / view.scale}px`,
                                            height: (p === 'e' || p === 'w') ? '40%' : `${8 / view.scale}px`,
                                            top: p.includes('n') ? 0 : (p.includes('s') ? '100%' : '50%'),
                                            left: p.includes('w') ? 0 : (p.includes('e') ? '100%' : '50%'),
                                            transform: 'translate(-50%, -50%)',
                                            borderRadius: p.length === 2 ? `${2 / view.scale}px` : `${4 / view.scale}px`,
                                            borderWidth: `${1 / view.scale}px`,
                                            cursor: activeLayerId ? `${p}-resize` : 'default',
                                            boxShadow: `0 ${2 / view.scale}px ${4 / view.scale}px rgba(0,0,0,0.3)`
                                        }} onPointerDown={handlePointerDown} />
                                    ))}
                                    <div className="crop-actions" style={{
                                        bottom: -45 / view.scale,
                                        gap: 12 / view.scale
                                    }}>
                                        <button
                                            onClick={() => { setIsCropActive(false); setTool('move'); }}
                                            className="crop-action-btn cancel"
                                            style={{
                                                padding: `${6 / view.scale}px`,
                                                borderRadius: `${6 / view.scale}px`
                                            }}
                                        >
                                            <X size={20 / view.scale} />
                                        </button>
                                        <button
                                            onClick={applyCrop}
                                            className="crop-action-btn confirm"
                                            style={{
                                                padding: `${6 / view.scale}px`,
                                                borderRadius: `${6 / view.scale}px`
                                            }}
                                        >
                                            <Check size={20 / view.scale} />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )
                        }
                    </div >
                </div >
            </div >

            {/* Panels */}
            {/* Left Dock: Tools & Adjustments */}
            <DraggableDock key={`left-${layoutKey}`} id="left" initialPos={{ x: 20, y: 80 }}>
                <CollapsiblePanel key={`adjust-${layoutKey}`} id="adjust" title={t('editor.adjustments')} icon={Sliders}>
                    {[
                        { label: t('editor.brightness'), field: 'brightness', icon: Sun, min: -1, max: 1 },
                        { label: t('editor.contrast'), field: 'contrast', icon: Contrast, min: -1, max: 1 },
                        { label: t('editor.gamma'), field: 'gamma', icon: Sliders, min: -1, max: 1 },
                        { label: t('editor.saturation'), field: 'saturation', icon: Droplets, min: -1, max: 1 },
                        { label: t('editor.exposure'), field: 'exposure', icon: Sun, min: -1, max: 1 },
                        { label: t('editor.temp'), field: 'temp', icon: Palette, min: -1, max: 1 },
                        { label: t('editor.tint'), field: 'tint', icon: Palette, min: -1, max: 1 },
                        { label: t('editor.vibrance'), field: 'vibrance', icon: Droplets, min: -1, max: 1 },
                        { label: t('editor.sepia'), field: 'sepia', icon: Palette, min: 0, max: 1 },
                        { label: t('editor.hue'), field: 'hue', icon: Palette, min: -1, max: 1 },
                        { label: t('editor.blur'), field: 'blur', icon: Maximize, min: 0, max: 50 },
                        { label: t('editor.clarity'), field: 'clarity', icon: Contrast, min: -1, max: 1 },
                        { label: t('editor.dehaze'), field: 'dehaze', icon: ImageIcon, min: -1, max: 1 },
                        { label: t('editor.opacity'), field: 'opacity', icon: Droplets, min: 0, max: 1 },
                    ].map(adj => {
                        const val = (activeLayerId === 'bg' || !activeLayerId)
                            ? (settings as any)[adj.field] ?? (adj.field === 'blur' || adj.field === 'exposure' || adj.field === 'sepia' || adj.field === 'hue' || adj.field === 'temp' || adj.field === 'tint' || adj.field === 'vibrance' || adj.field === 'clarity' || adj.field === 'gamma' || adj.field === 'brightness' || adj.field === 'contrast' || adj.field === 'saturation' ? 0 : 1)
                            : (textLayers.find(l => l.id === activeLayerId) || imageLayers.find(l => l.id === activeLayerId) as any)?.[adj.field] ?? (adj.field === 'blur' || adj.field === 'exposure' || adj.field === 'sepia' || adj.field === 'hue' || adj.field === 'temp' || adj.field === 'tint' || adj.field === 'vibrance' || adj.field === 'clarity' || adj.field === 'gamma' || adj.field === 'brightness' || adj.field === 'contrast' || adj.field === 'saturation' ? 0 : 1);

                        return (
                            <ControlSlider
                                key={adj.field}
                                label={adj.label}
                                value={val}
                                min={adj.min} max={adj.max} step={0.01}
                                defaultValue={adj.field === 'opacity' ? 1 : 0}
                                onInput={(_: any, v: any) => {
                                    if (!activeLayerId || activeLayerId === 'bg') setSettings(s => ({ ...s, [adj.field]: v }));
                                    else {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, [adj.field]: v } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, [adj.field]: v } : l));
                                    }
                                }}
                                onChange={(l: string) => saveHistory(l)}
                                field={adj.field}
                                icon={adj.icon}
                            />
                        );
                    })}
                    <div className="panel-divider" />
                    <button onClick={resetAdjustments} className="panel-reset-btn">
                        <ResetIcon size={14} />
                        {t('editor.reset_adjustments')}
                    </button>
                </CollapsiblePanel>

                <CollapsiblePanel id="color-balance" title={t('editor.color_balance')} icon={Palette} defaultCollapsed={true}>
                    {[
                        { title: t('editor.shadows'), fields: ['shR', 'shG', 'shB'] },
                        { title: t('editor.midtones'), fields: ['midR', 'midG', 'midB'] },
                        { title: t('editor.highlights'), fields: ['hiR', 'hiG', 'hiB'] },
                    ].map(group => (
                        <div key={group.title} className="color-balance-group">
                            <div className="group-title">{group.title}</div>
                            {group.fields.map(field => (
                                <ControlSlider
                                    key={field}
                                    label={field.endsWith('R') ? t('editor.red') : (field.endsWith('G') ? t('editor.green') : t('editor.blue'))}
                                    value={(activeLayerId === 'bg' || !activeLayerId)
                                        ? (settings as any)[field]
                                        : (textLayers.find(l => l.id === activeLayerId) || imageLayers.find(l => l.id === activeLayerId) as any)?.[field] ?? 0}
                                    min={-0.5} max={0.5} step={0.01}
                                    onInput={(_: any, v: any) => {
                                        if (!activeLayerId || activeLayerId === 'bg') setSettings(s => ({ ...s, [field]: v }));
                                        else {
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, [field]: v } : l));
                                            setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, [field]: v } : l));
                                        }
                                    }}
                                    onChange={(l: string) => saveHistory(l)}
                                    field={field}
                                />
                            ))}
                        </div>
                    ))}
                    <div className="panel-divider" />
                    <button onClick={resetColorBalance} className="panel-reset-btn">
                        <ResetIcon size={14} />
                        {t('editor.reset_color_balance')}
                    </button>
                </CollapsiblePanel>

                <CollapsiblePanel id="transform" title={t('editor.transform')} icon={Move} defaultCollapsed={true}>
                    <div className="transform-grid">
                        <div className="input-group">
                            <label htmlFor="transform-w-input" className="input-group-label">W</label>
                            <input
                                id="transform-w-input"
                                name="transformWidth"
                                type="number"
                                defaultValue={activeLayerId === 'bg' ? Math.round(isVertical ? settings.height : settings.width) : (textLayers.find(l => l.id === activeLayerId)?.fontSize || imageLayers.find(l => l.id === activeLayerId)?.width || 100)}
                                key={(activeLayerId || 'none') + (activeLayerId === 'bg' ? (isVertical ? settings.width : settings.height) : (textLayers.find(l => l.id === activeLayerId)?.fontSize || imageLayers.find(l => l.id === activeLayerId)?.width || 100))}
                                onBlur={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    if (activeLayerId === 'bg') {
                                        const isV = Math.abs(settings.rotation % 180) === 90;
                                        const ratio = settings.width / settings.height;
                                        let nextSettings = { ...settings };

                                        if (isLocked) {
                                            if (isV) nextSettings = { ...nextSettings, height: val, width: Math.round(val * ratio) };
                                            else nextSettings = { ...nextSettings, width: val, height: Math.round(val / ratio) };
                                        } else {
                                            if (isV) nextSettings = { ...nextSettings, height: val };
                                            else nextSettings = { ...nextSettings, width: val };
                                        }
                                        saveHistory(t('editor.history_resize'), { settings: nextSettings, textLayers, view, src: currSrc });
                                        setSettings(nextSettings);
                                    } else if (activeLayerId) {
                                        const nextLayers = textLayers.map(l => l.id === activeLayerId ? { ...l, fontSize: val } : l);
                                        saveHistory(t('editor.history_resize_text'), { settings, textLayers: nextLayers, view, src: currSrc });
                                        setTextLayers(nextLayers);
                                    }
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                className="input-group-field"
                            />
                        </div>

                        <Tooltip text={isLocked ? t('editor.unlock_ratio') : t('editor.lock_ratio')}>
                            <button
                                onClick={() => setIsLocked(!isLocked)}
                                className={`ie-lock-btn ${isLocked ? 'active' : ''}`}
                            >
                                {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                        </Tooltip>

                        <div className="input-group">
                            <label htmlFor="transform-h-input" className="input-group-label">H</label>
                            <input
                                id="transform-h-input"
                                name="transformHeight"
                                type="number"
                                defaultValue={activeLayerId === 'bg' ? Math.round(isVertical ? settings.width : settings.height) : (textLayers.find(l => l.id === activeLayerId)?.fontSize || imageLayers.find(l => l.id === activeLayerId)?.height || 100)}
                                key={(activeLayerId || 'none') + (activeLayerId === 'bg' ? (isVertical ? settings.height : settings.width) : (textLayers.find(l => l.id === activeLayerId)?.fontSize || imageLayers.find(l => l.id === activeLayerId)?.height || 100))}
                                onBlur={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    if (activeLayerId === 'bg') {
                                        const isV = Math.abs(settings.rotation % 180) === 90;
                                        const ratio = settings.width / settings.height;
                                        let nextSettings = { ...settings };

                                        if (isLocked) {
                                            if (isV) nextSettings = { ...nextSettings, width: Math.round(val * ratio), height: val };
                                            else nextSettings = { ...nextSettings, width: Math.round(val * ratio), height: val };
                                        } else {
                                            if (isV) nextSettings = { ...nextSettings, height: val };
                                            else nextSettings = { ...nextSettings, width: val };
                                        }
                                        saveHistory(t('editor.history_resize'), { settings: nextSettings, textLayers, imageLayers, view, src: currSrc });
                                        setSettings(nextSettings);
                                    } else if (textLayers.find(l => l.id === activeLayerId)) {
                                        const nextLayers = textLayers.map(l => l.id === activeLayerId ? { ...l, fontSize: val } : l);
                                        saveHistory(t('editor.history_resize_text'), { settings, textLayers: nextLayers, imageLayers, view, src: currSrc });
                                        setTextLayers(nextLayers);
                                    } else if (imageLayers.find(l => l.id === activeLayerId)) {
                                        const layer = imageLayers.find(l => l.id === activeLayerId)!;
                                        const ratio = layer.width / layer.height;
                                        const nextLayers = imageLayers.map(l => l.id === activeLayerId ? { ...l, height: val, width: isLocked ? Math.round(val * ratio) : l.width } : l);
                                        saveHistory(t('editor.history_resize_layer'), { settings, textLayers, imageLayers: nextLayers, view, src: currSrc });
                                        setImageLayers(nextLayers);
                                    }
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                className="input-group-field"
                            />
                        </div>
                    </div>

                    <div className="rotate-controls">
                        <Tooltip text={t('editor.rotate_left')}>
                            <button
                                onClick={() => {
                                    if (!activeLayerId) return;
                                    if (activeLayerId === 'bg') {
                                        const isVertical = Math.abs(settings.rotation % 180) === 90;
                                        const oldCW = isVertical ? settings.height : settings.width;
                                        const oldCH = isVertical ? settings.width : settings.height;

                                        const nextRot = (settings.rotation - 90) % 360;
                                        const nextIsV = Math.abs(nextRot % 180) === 90;
                                        const newCW = nextIsV ? settings.height : settings.width;
                                        const newCH = nextIsV ? settings.width : settings.height;

                                        const dx = (oldCW - newCW) * view.scale / 2;
                                        const dy = (oldCH - newCH) * view.scale / 2;

                                        const nextView = { ...view, x: view.x + dx, y: view.y + dy };
                                        const nextSettings = { ...settings, rotation: nextRot };

                                        setView(nextView);
                                        setSettings(nextSettings);
                                        saveHistory(t('editor.rotate_left'), { settings: nextSettings, textLayers, imageLayers, view: nextView, src: currSrc });
                                    } else {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: (l.rotation - 90) % 360 } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: (l.rotation - 90) % 360 } : l));
                                        saveHistory(t('editor.rotate_left'));
                                    }
                                }}
                                className="rotate-btn"
                            >
                                <RotateCcw size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip text={t('editor.rotate_right')}>
                            <button
                                onClick={() => {
                                    if (!activeLayerId) return;
                                    if (activeLayerId === 'bg') {
                                        const isVertical = Math.abs(settings.rotation % 180) === 90;
                                        const oldCW = isVertical ? settings.height : settings.width;
                                        const oldCH = isVertical ? settings.width : settings.height;

                                        const nextRot = (settings.rotation + 90) % 360;
                                        const nextIsV = Math.abs(nextRot % 180) === 90;
                                        const newCW = nextIsV ? settings.height : settings.width;
                                        const newCH = nextIsV ? settings.width : settings.height;

                                        const dx = (oldCW - newCW) * view.scale / 2;
                                        const dy = (oldCH - newCH) * view.scale / 2;

                                        const nextView = { ...view, x: view.x + dx, y: view.y + dy };
                                        const nextSettings = { ...settings, rotation: nextRot };

                                        setView(nextView);
                                        setSettings(nextSettings);
                                        saveHistory(t('editor.rotate_right'), { settings: nextSettings, textLayers, imageLayers, view: nextView, src: currSrc });
                                    } else {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: (l.rotation + 90) % 360 } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: (l.rotation + 90) % 360 } : l));
                                        saveHistory(t('editor.rotate_right'));
                                    }
                                }}
                                className="rotate-btn"
                            >
                                <RotateCw size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip text={t('editor.flip_x')}>
                            <button
                                onClick={() => {
                                    if (activeLayerId === 'bg') {
                                        setSettings(s => ({ ...s, flipH: !s.flipH }));
                                        saveHistory(t('editor.flip_x'));
                                    } else if (activeLayerId) {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, flipH: !l.flipH } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, flipH: !l.flipH } : l));
                                        saveHistory(t('editor.flip_x'));
                                    }
                                }}
                                className={`rotate-btn ${(activeLayerId === 'bg' ? settings.flipH : textLayers.find(l => l.id === activeLayerId)?.flipH) ? 'active' : ''}`}
                            >
                                <FlipHorizontal size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip text={t('editor.flip_y')}>
                            <button
                                onClick={() => {
                                    if (activeLayerId === 'bg') {
                                        setSettings(s => ({ ...s, flipV: !s.flipV }));
                                        saveHistory(t('editor.flip_y'));
                                    } else if (activeLayerId) {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, flipV: !l.flipV } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, flipV: !l.flipV } : l));
                                        saveHistory(t('editor.flip_y'));
                                    }
                                }}
                                className={`rotate-btn ${(activeLayerId === 'bg' ? settings.flipV : (textLayers.find(l => l.id === activeLayerId)?.flipV || imageLayers.find(l => l.id === activeLayerId)?.flipV)) ? 'active' : ''}`}
                            >
                                <FlipVertical size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip text={t('editor.reset_transform')}>
                            <button
                                onClick={() => {
                                    if (activeLayerId === 'bg') {
                                        resetTransform();
                                    } else if (activeLayerId) {
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: 0, flipH: false, flipV: false } : l));
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, rotation: 0, flipH: false, flipV: false } : l));
                                        saveHistory(t('editor.reset_transform'));
                                    }
                                }}
                                className="rotate-btn reset"
                            >
                                <ResetIcon size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </CollapsiblePanel>

                <CollapsiblePanel id="presets" title={t('editor.presets')} icon={Palette} defaultCollapsed={true}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px' }}>
                        <div className="presets-grid">
                            {presets.map(p => (
                                <div key={p.id} className="preset-item">
                                    <button
                                        onClick={() => {
                                            if (activeLayerId === 'bg') {
                                                const nextSettings = { ...settings, ...p.settings };
                                                saveHistory(t('editor.history_apply_preset', { name: p.name }), { settings: nextSettings, textLayers, imageLayers, view, src: currSrc });
                                                setSettings(nextSettings);
                                            } else if (activeLayerId) {
                                                const nextTextLayers = textLayers.map(l => l.id === activeLayerId ? { ...l, ...p.settings } : l);
                                                const nextImgLayers = imageLayers.map(l => l.id === activeLayerId ? { ...l, ...p.settings } : l);
                                                saveHistory(t('editor.history_apply_preset', { name: p.name }), { settings, textLayers: nextTextLayers, imageLayers: nextImgLayers, view, src: currSrc });
                                                setTextLayers(nextTextLayers);
                                                setImageLayers(nextImgLayers);
                                            }
                                        }}
                                        className="preset-btn"
                                    >
                                        {p.name}
                                    </button>
                                    <Tooltip text={t('editor.delete_preset_title')}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openConfirm(
                                                    t('editor.delete_preset_title'),
                                                    t('editor.delete_preset_confirm', { name: p.name }),
                                                    () => {
                                                        const nextPresets = presets.filter(item => item.id !== p.id);
                                                        setPresets(nextPresets);
                                                        localStorage.setItem('image_editor_presets', JSON.stringify(nextPresets));
                                                        showToast(t('editor.preset_deleted', { name: p.name }), 'info');
                                                    },
                                                    'danger'
                                                );
                                            }}
                                            className="preset-delete-btn"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </Tooltip>
                                </div>
                            ))}
                        </div>
                        <div style={{ borderTop: '1px solid #333', marginTop: '4px', paddingTop: '8px' }}>
                            <button
                                onClick={() => {
                                    setPresetName('');
                                    setShowSavePresetModal(true);
                                }}
                                className="save-preset-btn"
                            >
                                <Plus size={14} />
                                {t('editor.save_current_as_preset')}
                            </button>
                        </div>
                    </div>
                </CollapsiblePanel>
            </DraggableDock>

            {/* Right Dock: Layers & History */}
            <DraggableDock key={`right-${layoutKey}`} id="right" initialPos={{ x: window.innerWidth - 280, y: 80 }}>
                <CollapsiblePanel key={`layers-${layoutKey}`} id="layers" title={t('editor.layers')} icon={Layers}>
                    <div className="layers-list">
                        {[
                            ...[...textLayers].reverse().map(l => ({ ...l, type: 'text', text: l.text })),
                            ...[...imageLayers].reverse().map(l => ({ ...l, type: 'image', text: l.path.split(/[\\/]/).pop() })),
                            { id: 'bg', type: 'bg', text: t('editor.background') }
                        ].map((l: any) => (
                            <div key={l.id}
                                onClick={() => setActiveLayerId(l.id)}
                                className={`layer-item ${activeLayerId && activeLayerId === l.id ? 'active' : ''}`}>
                                {l.type === 'bg' ? <Maximize size={14} /> : l.type === 'image' ? <ImageIcon size={14} /> : <Type size={14} />}
                                <span>{l.text}</span>
                                {l.id !== 'bg' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            saveHistory(t('editor.history_delete_layer', { name: l.text }));
                                            if (l.type === 'text') setTextLayers(lc => lc.filter(x => x.id !== l.id));
                                            if (l.type === 'image') setImageLayers(lc => lc.filter(x => x.id !== l.id));
                                            if (activeLayerId === l.id) setActiveLayerId('bg');
                                        }}
                                        className="layer-delete-btn"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </CollapsiblePanel>

                {activeLayerId && textLayers.find(l => l.id === activeLayerId) && (
                    <CollapsiblePanel id="text-props" title={t('editor.text_properties')} icon={Type}>
                        <div className="text-props-container">
                            <div className="prop-section">
                                <label htmlFor="text-content-input" className="prop-label">{t('editor.content')}</label>
                                <textarea
                                    id="text-content-input"
                                    name="textContent"
                                    value={textLayers.find(l => l.id === activeLayerId)?.text || ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, text: val } : l));
                                    }}
                                    onBlur={() => saveHistory(t('editor.history_edit_text'))}
                                    className="prop-textarea"
                                />
                            </div>

                            <div className="prop-row">
                                <div className="prop-section">
                                    <label htmlFor="font-family-select" className="prop-label">{t('editor.font_family')}</label>
                                    <select
                                        id="font-family-select"
                                        name="fontFamily"
                                        value={textLayers.find(l => l.id === activeLayerId)?.fontFamily || 'Inter'}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, fontFamily: val } : l));
                                            saveHistory(t('editor.history_font_family'));
                                        }}
                                        className="prop-select"
                                    >
                                        <optgroup label={t('editor.font_group_modern')}>
                                            {['Inter', 'Roboto', 'Montserrat', 'Open Sans', 'Lato', 'Poppins', 'Ubuntu', 'Oswald', 'Raleway', 'Quicksand', 'Josefin Sans', 'Exo 2', 'Abel', 'Anton', 'Bebas Neue', 'Helvetica', 'Arial', 'Verdana', 'Tahoma'].map(f => (
                                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label={t('editor.font_group_classic')}>
                                            {['Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Cinzel', 'Georgia', 'Times New Roman', 'Garamond', 'Palatino'].map(f => (
                                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label={t('editor.font_group_script')}>
                                            {['Dancing Script', 'Pacifico', 'Caveat', 'Satisfy', 'Great Vibes', 'Brush Script MT'].map(f => (
                                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label={t('editor.font_group_display')}>
                                            {['Lobster', 'Righteous', 'Fredoka One', 'Permanent Marker', 'Impact', 'Luminari', 'Comic Sans MS'].map(f => (
                                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label={t('editor.font_group_mono')}>
                                            {['Fira Code', 'Roboto Mono', 'Source Code Pro', 'VT323', 'Courier New', 'Consolas'].map(f => (
                                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                </div>
                                <div className="prop-section">
                                    <label htmlFor="font-weight-select" className="prop-label">{t('editor.weight')}</label>
                                    <select
                                        id="font-weight-select"
                                        name="fontWeight"
                                        value={textLayers.find(l => l.id === activeLayerId)?.fontWeight || 'normal'}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, fontWeight: val } : l));
                                            saveHistory(t('editor.history_font_weight'));
                                        }}
                                        className="prop-select"
                                    >
                                        <option value="100">{t('editor.weight_thin')}</option>
                                        <option value="300">{t('editor.weight_light')}</option>
                                        <option value="400">{t('editor.weight_normal')}</option>
                                        <option value="500">{t('editor.weight_medium')}</option>
                                        <option value="600">{t('editor.weight_semibold')}</option>
                                        <option value="700">{t('editor.weight_bold')}</option>
                                        <option value="800">{t('editor.weight_extra_bold')}</option>
                                        <option value="900">{t('editor.weight_black')}</option>
                                    </select>
                                </div>
                            </div>

                            <div className="prop-row">
                                <div className="prop-section">
                                    <label htmlFor="font-size-input" className="prop-label">{t('editor.size')}</label>
                                    <input
                                        id="font-size-input"
                                        name="fontSize"
                                        type="number"
                                        value={textLayers.find(l => l.id === activeLayerId)?.fontSize || 40}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 0;
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, fontSize: val } : l));
                                        }}
                                        onBlur={() => saveHistory(t('editor.history_font_size'))}
                                        className="prop-input"
                                        autoComplete="off"
                                    />
                                </div>
                                <div className="prop-section">
                                    <label htmlFor="letter-spacing-input" className="prop-label">{t('editor.spacing')}</label>
                                    <input
                                        id="letter-spacing-input"
                                        name="letterSpacing"
                                        type="number"
                                        value={textLayers.find(l => l.id === activeLayerId)?.letterSpacing || 0}
                                        step="0.5"
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, letterSpacing: val } : l));
                                        }}
                                        onBlur={() => saveHistory(t('editor.history_letter_spacing'))}
                                        className="prop-input"
                                        autoComplete="off"
                                    />
                                </div>
                            </div>

                            <div className="prop-row">
                                <div className="prop-section">
                                    <label htmlFor="text-color-input" className="prop-label">{t('editor.color')}</label>
                                    <div className="color-picker-wrapper">
                                        <input
                                            id="text-color-input"
                                            name="textColor"
                                            type="color"
                                            value={textLayers.find(l => l.id === activeLayerId)?.color || '#ffffff'}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, color: val } : l));
                                            }}
                                            onBlur={() => saveHistory(t('editor.history_change_color'))}
                                            className="color-input"
                                            autoComplete="off"
                                        />
                                        <span className="color-code">
                                            {textLayers.find(l => l.id === activeLayerId)?.color}
                                        </span>
                                    </div>
                                </div>
                                <div className="prop-section">
                                    <label htmlFor="text-blend-mode-select" className="prop-label">{t('editor.blend_mode')}</label>
                                    <select
                                        id="text-blend-mode-select"
                                        name="textBlendMode"
                                        value={textLayers.find(l => l.id === activeLayerId)?.blendMode || 'normal'}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setTextLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, blendMode: val } : l));
                                            saveHistory(t('editor.history_blend_mode'));
                                        }}
                                        className="prop-select"
                                    >
                                        {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(m => (
                                            <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </CollapsiblePanel>
                )}

                {activeLayerId && imageLayers.find(l => l.id === activeLayerId) && (
                    <CollapsiblePanel id="layer-props" title={t('editor.layer_properties')} icon={ImageIcon}>
                        <div className="text-props-container">
                            <ControlSlider
                                label={t('editor.opacity')}
                                value={imageLayers.find(l => l.id === activeLayerId)?.opacity ?? 1}
                                min={0} max={1} step={0.01} field="opacity"
                                defaultValue={1}
                                onInput={(_f: string, v: number) => setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, opacity: v } : l))}
                                onChange={() => saveHistory(t('editor.opacity'))}
                            />
                            <div className="prop-section" style={{ marginTop: '8px' }}>
                                <label htmlFor="image-blend-mode-select" className="prop-label">{t('editor.blend_mode')}</label>
                                <select
                                    id="image-blend-mode-select"
                                    name="imageBlendMode"
                                    value={imageLayers.find(l => l.id === activeLayerId)?.blendMode || 'normal'}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setImageLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, blendMode: val } : l));
                                        saveHistory(t('editor.history_blend_mode'));
                                    }}
                                    className="prop-select"
                                >
                                    {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(m => (
                                        <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </CollapsiblePanel>
                )}

                <CollapsiblePanel id="history" title={t('editor.history')} icon={Undo2} defaultCollapsed={true}>
                    <div ref={historyInnerRef} className="history-list">
                        {[...undoStack, JSON.parse(lastSavedState.current || '{}'), ...[...redoStack].reverse()].map((state: any, i: number) => {
                            const isCurrent = i === undoStack.length;
                            return (
                                <div key={i}
                                    onClick={() => revertToState(i)}
                                    className={`history-item ${isCurrent ? 'active' : ''} ${i > undoStack.length ? 'future' : ''}`}
                                >
                                    <span>{i === 0 ? t('editor.original') : state._historyLabel || t('editor.action', { i })}</span>
                                    {isCurrent && <span className="history-time">{t('editor.now')}</span>}
                                </div>
                            );
                        })}
                    </div>
                </CollapsiblePanel>
            </DraggableDock>

            {/* Modals */}
            {
                showSaveModal && (
                    <div className="ie-save-modal-overlay">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="ie-save-modal-content"
                        >
                            <div className="ie-save-modal-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#3b82f6' }}>
                                    <Save size={20} />
                                    <h3 className="ie-save-modal-title">{t('editor.save_image')}</h3>
                                </div>
                                <p className="ie-save-modal-desc">{t('editor.save_image_desc')}</p>
                            </div>

                            <div className="ie-save-modal-body">
                                <div className="prop-section">
                                    <label htmlFor="save-filename-input" className="prop-label">{t('editor.filename')}</label>
                                    <input
                                        id="save-filename-input"
                                        name="saveFilename"
                                        autoFocus
                                        type="text"
                                        value={saveName}
                                        onChange={(e) => setSaveName(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                        className="prop-input"
                                        autoComplete="off"
                                    />
                                </div>

                                <div className="prop-section">
                                    <label htmlFor="save-path-input" className="prop-label">{t('editor.destination_folder')}</label>
                                    <div className="path-selector-wrapper">
                                        <Tooltip text={savePath}>
                                            <input
                                                id="save-path-input"
                                                name="savePath"
                                                type="text"
                                                readOnly
                                                value={savePath}
                                                className="prop-input path-display-input"
                                                autoComplete="off"
                                            />
                                        </Tooltip>
                                        <Tooltip text={t('editor.change_folder')}>
                                            <button
                                                onClick={handleSelectFolder}
                                                className="path-browse-btn"
                                            >
                                                <Folder size={18} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                </div>

                                <div className="prop-section">
                                    <span className="prop-label">{t('editor.format')}</span>
                                    <div className="format-selector">
                                        {['jpg', 'png'].map(ext => (
                                            <button
                                                key={ext}
                                                onClick={() => setSaveFormat(ext as any)}
                                                className={`ie-format-btn ${ext} ${saveFormat === ext ? 'active' : ''}`}
                                            >
                                                {ext}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="ie-save-modal-footer">
                                <button
                                    onClick={() => setShowSaveModal(false)}
                                    className="ie-cancel-btn"
                                >
                                    {t('editor.cancel')}
                                </button>
                                <button
                                    onClick={performSave}
                                    disabled={isSaving || !saveName.trim()}
                                    className="ie-save-btn"
                                >
                                    {isSaving ? (
                                        <>
                                            <div className="saving-spinner" />
                                            {t('editor.saving')}
                                        </>
                                    ) : (
                                        <>
                                            <Save size={16} />
                                            <span>{t('editor.save')}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )
            }
            {
                showSavePresetModal && (
                    <div className="modal-overlay">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            className="preset-modal-content"
                        >
                            <div className="modal-header">
                                <h3 className="modal-header-title">{t('editor.new_preset')}</h3>
                                <p className="modal-desc">{t('editor.preset_desc')}</p>
                            </div>

                            <div className="modal-body">
                                <label htmlFor="preset-name-input" className="prop-label">{t('editor.preset_name')}</label>
                                <input
                                    id="preset-name-input"
                                    name="presetName"
                                    autoFocus
                                    type="text"
                                    value={presetName}
                                    onChange={(e) => setPresetName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && presetName.trim()) {
                                            const name = presetName.trim();
                                            const currentFilters = activeLayerId === 'bg'
                                                ? { brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation, exposure: settings.exposure, sepia: settings.sepia, hue: settings.hue, blur: settings.blur, opacity: settings.opacity }
                                                : (textLayers.find(l => l.id === activeLayerId) || {});

                                            const newPreset = {
                                                id: Math.random().toString(36).substr(2, 9),
                                                name,
                                                settings: JSON.parse(JSON.stringify(currentFilters))
                                            };
                                            const nextPresets = [...presets, newPreset];
                                            setPresets(nextPresets);
                                            localStorage.setItem('image_editor_presets', JSON.stringify(nextPresets));
                                            setShowSavePresetModal(false);
                                            showToast(t('editor.preset_saved', { name }), 'success');
                                        }
                                        if (e.key === 'Escape') setShowSavePresetModal(false);
                                    }}
                                    placeholder={t('editor.preset_placeholder')}
                                    className="prop-input"
                                    autoComplete="off"
                                />
                            </div>

                            <div className="modal-actions">
                                <button
                                    onClick={() => setShowSavePresetModal(false)}
                                    className="cancel-btn"
                                >
                                    {t('editor.cancel')}
                                </button>
                                <button
                                    onClick={() => {
                                        if (!presetName.trim()) return;
                                        const name = presetName.trim();
                                        const currentFilters = activeLayerId === 'bg'
                                            ? { brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation, exposure: settings.exposure, sepia: settings.sepia, hue: settings.hue, blur: settings.blur, opacity: settings.opacity }
                                            : (textLayers.find(l => l.id === activeLayerId) || {});

                                        const newPreset = {
                                            id: Math.random().toString(36).substr(2, 9),
                                            name,
                                            settings: JSON.parse(JSON.stringify(currentFilters))
                                        };
                                        const nextPresets = [...presets, newPreset];
                                        setPresets(nextPresets);
                                        localStorage.setItem('image_editor_presets', JSON.stringify(nextPresets));
                                        setShowSavePresetModal(false);
                                    }}
                                    className="confirm-action-btn"
                                >
                                    {t('editor.save')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )
            }

            {/* Confirm Modal */}
            {
                confirmModal && confirmModal.show && (
                    <div className="modal-overlay">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="modal-confirm-content"
                        >
                            <div className="modal-header">
                                <div className="modal-icon-wrapper danger">
                                    <AlertCircle size={20} />
                                    <h3 className="modal-header-title">{confirmModal.title}</h3>
                                </div>
                                <p className="modal-desc">{confirmModal.message}</p>
                            </div>
                            <div className="modal-actions">
                                <button
                                    onClick={() => setConfirmModal(null)}
                                    className="cancel-btn"
                                >
                                    {t('editor.cancel')}
                                </button>
                                <button
                                    onClick={() => {
                                        confirmModal.onConfirm();
                                        setConfirmModal(null);
                                    }}
                                    className={`confirm-action-btn ${confirmModal.type === 'danger' ? 'red' : ''}`}
                                >
                                    {t('editor.confirm_title')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )
            }

            {/* Toasts */}
            {/* Toasts */}
            <div className="toast-container">
                <AnimatePresence>
                    {notifications.map(n => (
                        <motion.div
                            key={n.id}
                            initial={{ opacity: 0, x: 50, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8, x: 20 }}
                            className={`toast-notification ${n.type === 'error' ? 'toast-error' : n.type === 'success' ? 'toast-success' : 'toast-info'}`}
                        >
                            {n.type === 'success' && <Check size={16} />}
                            {n.type === 'error' && <AlertCircle size={16} />}
                            {n.type === 'info' && <Bell size={16} />}
                            <span className="toast-message">{n.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div >
    );
};

export default ImageEditor;
