import React, { useState, useEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { LayoutTemplate, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import Tooltip from '../Tooltip';

interface DraggableDockProps {
    id: string;
    initialPos: { x: number; y: number };
    title: string;
    children: React.ReactNode;
    panelWidth?: number;
    onClose?: () => void;
    resizable?: boolean;
    aspectRatio?: number;
}

const DraggableDock: React.FC<DraggableDockProps> = ({
    id, initialPos, title, children, panelWidth = 260, onClose, resizable = false, aspectRatio
}) => {
    const dragControls = useDragControls();
    const { t } = useLanguage();
    const [isCollapsed, setIsCollapsed] = useState(() => {
        return localStorage.getItem(`ve_dock_collapsed_${id}`) === 'true';
    });
    const [width, setWidth] = useState(() => {
        const saved = localStorage.getItem(`ve_dock_width_${id}`);
        return saved ? parseInt(saved) : panelWidth;
    });

    const [pos, setPos] = useState(() => {
        try {
            const p = localStorage.getItem(`ve_dock_pos_${id}`);
            const savedPos = p ? JSON.parse(p) : initialPos;
            return {
                x: Math.max(0, Math.min(window.innerWidth - width, savedPos.x)),
                y: Math.max(0, Math.min(window.innerHeight - 100, savedPos.y))
            };
        } catch { return initialPos; }
    });

    useEffect(() => {
        const updateConstraints = () => {
            setPos(prev => ({
                x: Math.max(0, Math.min(window.innerWidth - width, prev.x)),
                y: Math.max(0, Math.min(window.innerHeight - 50, prev.y))
            }));
        };
        window.addEventListener('resize', updateConstraints);
        return () => window.removeEventListener('resize', updateConstraints);
    }, [width]);

    const toggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newState = !isCollapsed;
        setIsCollapsed(newState);
        localStorage.setItem(`ve_dock_collapsed_${id}`, String(newState));
    };

    const handleResizeStart = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startWidth = width;

        const onMove = (moveEvent: PointerEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = Math.max(150, Math.min(window.innerWidth - pos.x - 20, startWidth + deltaX));
            setWidth(newWidth);
            localStorage.setItem(`ve_dock_width_${id}`, String(newWidth));
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

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
                const padding = 10;
                const newX = Math.max(padding, Math.min(window.innerWidth - panelWidth - padding, absoluteX));
                const newY = Math.max(padding, Math.min(window.innerHeight - 40 - padding, absoluteY));
                const newPos = { x: newX, y: newY };
                setPos(newPos);
                localStorage.setItem(`ve_dock_pos_${id}`, JSON.stringify(newPos));
            }}
            className={`ve-panel-dock ${isCollapsed ? 'collapsed' : ''}`}
            style={{
                position: 'fixed',
                zIndex: 4000,
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                width: width,
                pointerEvents: 'auto',
                top: 0,
                left: 0
            }}
        >
            <div
                onPointerDown={(e) => dragControls.start(e)}
                onDoubleClick={toggleCollapse}
                className="ve-dock-handle"
                style={{ cursor: 'grab' }}
            >
                <div className="ve-dock-dots" style={{ pointerEvents: 'none' }}>
                    <LayoutTemplate size={12} />
                    <span>{title}</span>
                </div>
                <div className="ve-dock-header-actions">
                    <Tooltip text={isCollapsed ? t('tooltip.expand') : t('tooltip.collapse')}>
                        <button
                            className="ve-dock-btn"
                            onClick={toggleCollapse}
                            onPointerDown={e => e.stopPropagation()}
                        >
                            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </Tooltip>
                    {onClose && (
                        <Tooltip text={t('common.close')}>
                            <button
                                className="ve-dock-btn close"
                                onClick={(e) => { e.stopPropagation(); onClose(); }}
                                onPointerDown={e => e.stopPropagation()}
                                style={{ color: '#ef4444' }}
                            >
                                <X size={14} />
                            </button>
                        </Tooltip>
                    )}
                </div>
            </div>
            <div
                className="ve-dock-content"
                style={{
                    maxHeight: isCollapsed ? 0 : '80vh',
                    aspectRatio: (!isCollapsed && aspectRatio) ? `${aspectRatio}` : 'auto'
                }}
            >
                {children}
            </div>
            {resizable && !isCollapsed && (
                <div
                    className="ve-dock-resize-handle"
                    onPointerDown={handleResizeStart}
                    style={{
                        position: 'absolute',
                        right: 0,
                        bottom: 0,
                        width: '12px',
                        height: '12px',
                        cursor: 'nwse-resize',
                        zIndex: 10,
                        background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.1) 50%)',
                        borderBottomRightRadius: '4px'
                    }}
                />
            )}
        </motion.div>
    );
};

export default DraggableDock;
