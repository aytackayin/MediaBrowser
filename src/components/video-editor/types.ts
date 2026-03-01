// ─── Shared Types for VideoEditor ───

export interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
    size: number;
    mtime: number;
    duration?: number;
    width?: number;
    height?: number;
}

export interface Clip {
    id: number;
    path: string;
    mtime?: number; // Added for cache busting
    name: string;
    timelineStart: number;
    sourceStart: number;
    duration: number;
    speed?: number; // Added for playback rate control
    type?: 'video' | 'audio' | 'image' | 'text';
    textData?: {
        text: string;
        fontSize: number;
        color: string;
        fontFamily?: string;
        fontWeight?: string;
        letterSpacing?: number;
    };
    transform?: {
        x: number;
        y: number;
        scaleX: number;
        scaleY: number;
        rotation?: number;
        flipX?: boolean;
        flipY?: boolean;
    };
    crop?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    settings?: VideoSettings;
    width?: number;
    height?: number;
    volume?: number; // Added for audio control (0.0 to 1.0)
    fadeIn?: number; // Seconds
    fadeOut?: number; // Seconds
    base64_image?: string;
}

export interface Track {
    id: number;
    type: 'video' | 'audio';
    name: string;
    clips: Clip[];
    color?: string; // Add optional color for testing
}

export interface VideoSettings {
    brightness: number;
    contrast: number;
    saturation: number;
    exposure: number;
    temp: number;
    tint: number;
    vignette: number;
    gamma: number;
    vibrance: number;
    clarity: number;
    sepia: number;
    hue: number;
    blur: number;
    dehaze: number;
    opacity: number;
    shR?: number;
    shG?: number;
    shB?: number;
    midR?: number;
    midG?: number;
    midB?: number;
    hiR?: number;
    hiG?: number;
    hiB?: number;
}

export interface ExportSettings extends VideoSettings {
    canvasWidth?: number;
    canvasHeight?: number;
}

export interface VideoEditorProps {
    file: MediaFile | null;
    onClose: () => void;
    onSaveSuccess?: (savedFile: MediaFile) => void;
    galleryRoot?: string;
}

export const DEFAULT_SETTINGS: VideoSettings = {
    brightness: 0.0,
    contrast: 0.0,
    saturation: 0.0,
    exposure: 0.0,
    temp: 0.0,
    tint: 0.0,
    vignette: 0.0,
    gamma: 0.0,
    vibrance: 0.0,
    clarity: 0.0,
    sepia: 0.0,
    hue: 0.0,
    blur: 0.0,
    dehaze: 0.0,
    opacity: 1.0,
    shR: 0,
    shG: 0,
    shB: 0,
    midR: 0,
    midG: 0,
    midB: 0,
    hiR: 0,
    hiG: 0,
    hiB: 0,
};
