import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './Tooltip.css';

interface TooltipProps {
    text: string;
    children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const tooltipRef = useRef<HTMLDivElement>(null);

    const updatePosition = (x: number, y: number) => {
        if (tooltipRef.current) {
            const rect = tooltipRef.current.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;
            const gap = 12;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const midX = viewportWidth / 2;
            const midY = viewportHeight / 2;

            let offsetX = 0;
            let offsetY = 0;

            // Use estimated dimensions if width/height are not yet available (0 during mount)
            const w = width || 120;
            const h = height || 32;

            if (x < midX && y < midY) {
                // Quadrant 1: Top-Left -> Show Bottom-Right
                offsetX = gap;
                offsetY = gap;
            } else if (x >= midX && y < midY) {
                // Quadrant 2: Top-Right -> Show Bottom-Left
                offsetX = -w - gap;
                offsetY = gap;
            } else if (x < midX && y >= midY) {
                // Quadrant 3: Bottom-Left -> Show Top-Right
                offsetX = gap;
                offsetY = -h - gap;
            } else {
                // Quadrant 4: Bottom-Right -> Show Top-Left
                offsetX = -w - gap;
                offsetY = -h - gap;
            }

            setOffset({ x: offsetX, y: offsetY });
        }
    };

    const handleMouseMove = (e: MouseEvent | React.MouseEvent) => {
        const x = e.clientX;
        const y = e.clientY;
        setMousePos({ x, y });
        updatePosition(x, y);
    };

    useEffect(() => {
        if (isVisible) {
            // Immediate update on show
            const timer = setTimeout(() => {
                updatePosition(mousePos.x, mousePos.y);
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [isVisible]);

    const tooltipContent = (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    ref={tooltipRef}
                    className="tooltip-content"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.1, ease: 'easeOut' }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        x: mousePos.x + offset.x,
                        y: mousePos.y + offset.y,
                        pointerEvents: 'none'
                    }}
                >
                    {text}
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <div
            className="tooltip-trigger"
            onMouseEnter={(e) => {
                setMousePos({ x: e.clientX, y: e.clientY });
                setIsVisible(true);
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {createPortal(tooltipContent, document.body)}
        </div>
    );
};

export default Tooltip;
