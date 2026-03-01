import React, { useMemo, useRef, useEffect } from 'react';
import { useLanguage } from '../LanguageContext';
import DraggableDock from './DraggableDock';

interface DraggableHistoryProps {
    undoStack: any[];
    redoStack: any[];
    lastSavedState: React.MutableRefObject<string>;
    revertToState: (index: number) => void;
}

const DraggableHistory: React.FC<DraggableHistoryProps> = ({
    undoStack, redoStack, lastSavedState, revertToState
}) => {
    const { t } = useLanguage();
    const historyInnerRef = useRef<HTMLDivElement>(null);

    // Build history list
    const historyList = useMemo(() => {
        try {
            const current = JSON.parse(lastSavedState.current || '{}');
            return [...undoStack, current, ...[...redoStack].reverse()];
        } catch { return []; }
    }, [undoStack, redoStack, lastSavedState]);

    useEffect(() => {
        if (historyInnerRef.current) {
            historyInnerRef.current.scrollTo({ top: historyInnerRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [historyList.length]);

    return (
        <DraggableDock
            id="history"
            title={t('editor.history')}
            initialPos={{ x: window.innerWidth - 300, y: 150 }}
        >
            <div className="ve-history-panel">
                <div ref={historyInnerRef} className="ve-history-list">
                    {historyList.map((state: any, i: number) => {
                        const isCurrent = i === undoStack.length;
                        return (
                            <div
                                key={i}
                                onClick={() => revertToState(i)}
                                className={`ve-history-item ${isCurrent ? 'active' : ''} ${i > undoStack.length ? 'future' : ''}`}
                            >
                                <span>{i === 0 ? t('history.initial') : state._historyLabel || `${t('history.editing')} ${i}`}</span>
                                {isCurrent && <span className="ve-history-time">{t('editor.now')}</span>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </DraggableDock>
    );
};

export default DraggableHistory;
