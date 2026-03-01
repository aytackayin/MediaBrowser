import { useState, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/Sidebar';
import {
  X, Trash2, RefreshCw, ChevronDown, CheckCircle
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import MediaBrowser from './components/MediaBrowser';
import ImageEditor from './components/ImageEditor';
import VideoEditor from './components/VideoEditor';
import VideoConverter from './components/video-converter/VideoConverter';
import SettingsPage from './components/SettingsPage';
import MediaPlayer from './components/MediaPlayer';
import TitleBar from './components/TitleBar';
import MediaInfoModal from './components/MediaInfoModal';
import FolderPickerModal from './components/FolderPickerModal';
import './components/MediaBrowser.css';
import './App.css';
import { LanguageProvider, useLanguage } from './components/LanguageContext';

interface Gallery {
  id: string;
  name: string;
  path: string;
}

interface MediaFile {
  path: string;
  filename: string;
  file_type: string;
  size: number;
  mtime: number;
  width?: number;
  height?: number;
  duration?: number;
}


function AppContent() {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<MediaFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeletionMenu, setShowDeletionMenu] = useState(false);
  const [deletionMethod, setDeletionMethod] = useState<string>('DoD3');

  useEffect(() => {
    if (fileToDelete) {
      const savedMethod = localStorage.getItem('shred_method') || 'DoD3';
      setDeletionMethod(savedMethod);
    }
  }, [fileToDelete]);
  const [itemToMoveCopy, setItemToMoveCopy] = useState<MediaFile | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [previousView, setPreviousView] = useState<string>('browser');
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };
  const {
    activeTab, view, setView, selectedFile, setSelectedFile,
    files, setFiles, t, galleries, setGalleries,
    activeGalleryId, setActiveGalleryId,
    currentPath, setCurrentPath, highlightedPath, setHighlightedPath,
    currentPage, setCurrentPage, sortBy, setSortBy, sortOrder, setSortOrder,
    filterType, setFilterType, totalItems, setTotalItems,
    searchQuery, setSearchQuery, busyGalleryIds, setBusyGalleryIds,
    loading, setLoading, pendingHighlight, setPendingHighlight,
    pendingPlayerSelect, setPendingPlayerSelect,
    totalImages, setTotalImages,
    totalVideos, setTotalVideos,
    totalAudio, setTotalAudio
  } = useAppState();

  // Clean all gallery temp folders and show window on app startup
  useEffect(() => {
    invoke('show_main_window').catch(() => { });
    galleries.forEach(g => {
      invoke('clean_gallery_temp', { galleryRoot: g.path }).catch(() => { });
    });
  }, []); // Only once on mount

  const translateError = (error: any): string => {
    const msg = typeof error === 'string' ? error : (error?.toString?.() || '');
    const errorMap: Record<string, string> = {
      'Destination already exists': t('error.destination_already_exists'),
      'Folder already exists': t('error.folder_already_exists'),
      'A file with the same name already exists': t('error.file_already_exists'),
      'File not found': t('error.file_not_found'),
      'Permission denied': t('error.permission_denied'),
    };
    for (const [key, value] of Object.entries(errorMap)) {
      if (msg.includes(key)) return value;
    }
    return msg || t('error.unknown');
  };

  const prevPathRef = useRef<string | null>(null);
  const prevSearchRef = useRef(searchQuery);
  const prevSortRef = useRef(sortBy);
  const prevOrderRef = useRef(sortOrder);
  const prevPageRef = useRef(currentPage);
  const prevFilterRef = useRef(filterType);

  const activeGallery = useMemo(() => galleries.find(g => g.id === activeGalleryId), [galleries, activeGalleryId]);

  const normalizePath = (p: string) => {
    if (!p) return '';
    const isWindows = p.includes('\\') || /^[A-Z]:/i.test(p);
    const separator = isWindows ? '\\' : '/';
    let normalized = p.replace(/[\\/]+/g, separator);
    if (isWindows) {
      if (normalized.length > 3 && normalized.endsWith('\\')) normalized = normalized.slice(0, -1);
    } else {
      if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    }
    return normalized;
  };

  const isPathsEqual = (p1: string | null, p2: string | null) => {
    if (!p1 || !p2) return p1 === p2;
    const n1 = normalizePath(p1);
    const n2 = normalizePath(p2);
    const isWindows = n1.includes('\\') || /^[A-Z]:/i.test(n1);
    if (isWindows) return n1.toLowerCase() === n2.toLowerCase();
    return n1 === n2;
  };

  const scanFolder = async (inputPath?: string, page: number = 1, queryOverride?: string) => {
    try {
      let path = inputPath ? normalizePath(inputPath) : null;
      if (!path) {
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
          const selectedPath = typeof selected === 'string' ? selected : (selected as any).path || (selected as any)[0];
          path = normalizePath(selectedPath);
        }
      }

      if (path) {
        prevPathRef.current = path;
        setCurrentPath(path);
        setLoading(true);
        const currentQuery = queryOverride !== undefined ? queryOverride : searchQuery;

        const result: any = await invoke('scan_folder', {
          path,
          galleryRoot: activeGallery?.path,
          page,
          pageSize: 100,
          sortBy,
          sortDirection: sortOrder,
          searchQuery: currentQuery,
          filterType
        });

        setFiles(result.items);
        setTotalItems(result.total);
        setTotalImages(result.count_image);
        setTotalVideos(result.count_video);
        setTotalAudio(result.count_audio);
        setCurrentPage(page);
        setLoading(false);

        if (pendingHighlight && result.items.length > 0) {
          const target = pendingHighlight === 'first' ? result.items[0] : result.items[result.items.length - 1];
          setHighlightedPath(target.path);
          setPendingHighlight(null);
        }

        if (view === 'player' && pendingPlayerSelect && result.items.length > 0) {
          const mediaFiles = result.items.filter((f: any) => f.file_type !== 'folder');
          if (mediaFiles.length > 0) {
            setSelectedFile(pendingPlayerSelect === 'first' ? mediaFiles[0] : mediaFiles[mediaFiles.length - 1]);
          }
          setPendingPlayerSelect(null);
        }
      }
    } catch (error) { setLoading(false); }
  };

  useEffect(() => {
    const path = currentPath || activeGallery?.path;
    if (path) {
      const nPath = normalizePath(path);
      const nPrev = prevPathRef.current ? normalizePath(prevPathRef.current) : null;

      const pathChanged = !isPathsEqual(nPath, nPrev);
      const searchChanged = prevSearchRef.current !== searchQuery;
      const sortChanged = prevSortRef.current !== sortBy || prevOrderRef.current !== sortOrder;
      const pageChanged = prevPageRef.current !== currentPage;
      const filterChanged = prevFilterRef.current !== filterType;

      if (pathChanged || searchChanged || sortChanged || pageChanged || filterChanged) {
        const targetPage = (pathChanged || searchChanged || sortChanged || filterChanged) ? 1 : currentPage;

        prevSearchRef.current = searchQuery;
        prevSortRef.current = sortBy;
        prevOrderRef.current = sortOrder;
        prevPageRef.current = targetPage;
        prevFilterRef.current = filterType;

        scanFolder(path, targetPage);
      }
    }
  }, [activeGallery?.path, currentPath, searchQuery, sortBy, sortOrder, currentPage, filterType]);

  useEffect(() => {
    const unlistenPromise = listen('library-changed', () => {
      const path = currentPath || activeGallery?.path;
      if (path) {
        scanFolder(path, currentPage);
      }
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [currentPath, currentPage, activeGallery?.path]);

  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      const matchesTab = activeTab === 'all' || file.file_type === 'folder' ||
        (activeTab === 'images' && file.file_type === 'image') ||
        (activeTab === 'videos' && file.file_type === 'video') ||
        (activeTab === 'audio' && file.file_type === 'audio');
      // matchesFilter handled by backend
      return matchesTab;
    });
  }, [files, activeTab]);

  const handleFileUpdate = (updatedFile: MediaFile) => {
    setFiles(prev => prev.map(f => f.path === updatedFile.path ? updatedFile : f));
    if (selectedFile?.path === updatedFile.path) {
      setSelectedFile(updatedFile);
    }
  };

  const openInEditor = (file: MediaFile) => {
    setPreviousView(view);
    setSelectedFile(file);
    if (file.file_type === 'video' || file.file_type === 'audio') {
      setView('video_editor');
    } else {
      setView('editor');
    }
  };

  const handleOpenExternalImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: t('sidebar.images'),
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']
        }]
      });

      if (selected && typeof selected === 'string') {
        const path = normalizePath(selected);
        const filename = path.split(/[\\/]/).pop() || '';

        const externalFile: MediaFile = {
          path,
          filename,
          file_type: 'image',
          size: 0,
          mtime: Date.now()
        };

        setSelectedFile(externalFile);
        setPreviousView(view);
        setView('editor');
      }
    } catch (error) {
    }
  };

  const handleOpenExternalVideo = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: t('sidebar.videos'),
          extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv']
        }]
      });

      if (selected && typeof selected === 'string') {
        const path = normalizePath(selected);
        const filename = path.split(/[\\/]/).pop() || '';

        const externalFile: MediaFile = {
          path,
          filename,
          file_type: 'video',
          size: 0,
          mtime: Date.now()
        };

        setSelectedFile(externalFile);
        setPreviousView(view);
        setView('video_editor');
      }
    } catch (error) {
    }
  };

  const handleOpenExternalConverter = () => {
    setPreviousView(view);
    setView('video_converter');
  };

  const handleFileSaved = (savedFile: MediaFile) => {
    // Do not switch selectedFile if the path changed, to prevent the editor from re-initializing/resetting.
    // This allows users to continue editing their project after an export/save-as.
    // Prevent state reset while editor is open
    if (view !== 'video_editor' && view !== 'editor' && selectedFile?.path === savedFile.path) {
      setSelectedFile(savedFile);
    }

    const savedDir = savedFile.path.includes('\\')
      ? savedFile.path.substring(0, savedFile.path.lastIndexOf('\\'))
      : savedFile.path.substring(0, savedFile.path.lastIndexOf('/'));

    const currentDir = currentPath || activeGallery?.path || '';

    if (isPathsEqual(savedDir, currentDir)) {
      setFiles(prev => {
        const exists = prev.find(f => f.path === savedFile.path);
        if (exists) {
          return prev.map(f => f.path === savedFile.path ? savedFile : f);
        } else {
          if (savedFile.file_type === 'video') setTotalVideos(v => v + 1);
          else if (savedFile.file_type === 'image') setTotalImages(v => v + 1);
          else if (savedFile.file_type === 'audio') setTotalAudio(v => v + 1);
          setTotalItems(v => v + 1);
          return [...prev, savedFile];
        }
      });
    }
  };

  const handleDeleteFile = () => {
    if (!selectedFile) return;
    setFileToDelete(selectedFile);
  };

  const handleDeleteConfirm = async () => {
    if (!fileToDelete || !activeGallery?.path) return;
    setIsDeleting(true);
    try {
      await invoke('delete_media_file', {
        path: fileToDelete.path,
        galleryRoot: activeGallery.path,
        method: deletionMethod
      });

      const idx = filteredFiles.findIndex(f => f.path === fileToDelete.path);
      let nextFile = null;

      for (let i = idx + 1; i < filteredFiles.length; i++) {
        if (filteredFiles[i].file_type !== 'folder') {
          nextFile = filteredFiles[i];
          break;
        }
      }

      if (!nextFile) {
        for (let i = idx - 1; i >= 0; i--) {
          if (filteredFiles[i].file_type !== 'folder') {
            nextFile = filteredFiles[i];
            break;
          }
        }
      }

      setFileToDelete(null);

      if (currentPath) scanFolder(currentPath, currentPage);

      if (nextFile) {
        setSelectedFile(nextFile);
      } else {
        setView('browser');
      }
      showToast(t('modal.delete_success'));
    } catch (err: any) {
      showToast(t('toast.process_failed') + translateError(err), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopyFile = () => {
    if (!selectedFile) return;
    setItemToMoveCopy(selectedFile);
  };

  const handleMoveCopySelect = async (destinationPath: string, action: 'copy' | 'move') => {
    if (!itemToMoveCopy || !activeGallery?.path) return;
    setIsProcessingAction(true);
    try {
      const result: { success_count: number, skip_count: number } = await invoke(
        action === 'move' ? 'move_media_item' : 'copy_media_item',
        {
          oldPath: itemToMoveCopy.path,
          newParentPath: destinationPath,
          galleryRoot: activeGallery.path
        }
      );

      const totalSuccess = result.success_count;
      const totalSkip = result.skip_count;

      setItemToMoveCopy(null);

      if (totalSkip > 0) {
        const summaryKey = action === 'move' ? 'toast.move_summary' : 'toast.copy_summary';
        showToast(t(summaryKey, { success: totalSuccess, skip: totalSkip }), totalSuccess > 0 ? 'success' : 'info');
      } else if (totalSuccess > 0) {
        const successKey = action === 'move' ? 'toast.move_success' : 'toast.copy_success';
        showToast(t(successKey));
      }

      if (action === 'move' && totalSuccess > 0) {
        const idx = filteredFiles.findIndex(f => f.path === itemToMoveCopy.path);
        let nextFile = null;

        for (let i = idx + 1; i < filteredFiles.length; i++) {
          if (filteredFiles[i].file_type !== 'folder') {
            nextFile = filteredFiles[i];
            break;
          }
        }
        if (!nextFile) {
          for (let i = idx - 1; i >= 0; i--) {
            if (filteredFiles[i].file_type !== 'folder') {
              nextFile = filteredFiles[i];
              break;
            }
          }
        }

        if (nextFile) {
          setSelectedFile(nextFile);
        } else {
          setView('browser');
        }
      }

      if (currentPath) scanFolder(currentPath, currentPage);
    } catch (error: any) {
      showToast(t('toast.process_failed') + translateError(error), 'error');
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div className="app-container">
      {(view === 'browser' || view === 'settings') && (
        <Sidebar
          view={view as any}
          galleries={galleries}
          activeGalleryId={activeGalleryId}
          busyGalleryIds={busyGalleryIds}
          onOpenExternalImage={handleOpenExternalImage}
          onOpenExternalVideo={handleOpenExternalVideo}
          onOpenExternalConverter={handleOpenExternalConverter}
          setActiveGalleryId={(id: string) => {
            const clickedGallery = galleries.find(g => g.id === id);

            if (id === activeGalleryId && clickedGallery) {
              if (currentPath && currentPath !== clickedGallery.path) {
                const root = clickedGallery.path.replace(/[\\/]+$/, '');
                const current = currentPath.replace(/[\\/]+$/, '');

                if (current.startsWith(root)) {
                  const relative = current.substring(root.length).replace(/^[\\/]+/, '');
                  const parts = relative.split(/[\\/]/);
                  if (parts.length > 0) {
                    const isWin = clickedGallery.path.includes('\\') || /^[A-Z]:/i.test(clickedGallery.path);
                    const sep = isWin ? '\\' : '/';
                    const highlightPath = clickedGallery.path + (clickedGallery.path.endsWith(sep) ? '' : sep) + parts[0];
                    setHighlightedPath(highlightPath);
                  }
                }
              }
              setCurrentPath(clickedGallery.path);
              setCurrentPage(1);
              if (view !== 'browser') {
                prevPathRef.current = null;
              }
            } else {
              setActiveGalleryId(id);
              setCurrentPath(null);
              setHighlightedPath(null);
              setCurrentPage(1);
              setFiles([]);
              prevPathRef.current = null;
            }
            setView('browser');
          }}
          setView={(v: any) => {
            if (v === 'settings') {
              setFiles([]);
              setCurrentPath(null);
              setHighlightedPath(null);
              prevPathRef.current = null;
            }
            setView(v);
          }}
        />
      )}

      <div className="main-layout">
        {view === 'browser' ? (
          <MediaBrowser
            key={activeGalleryId || 'empty'}
            activeTab={activeTab}
            files={files}
            setFiles={setFiles}
            onFileSelect={openInEditor}
            onOpenPlayer={(file: MediaFile) => {
              setSelectedFile(file);
              setView('player');
            }}
            initialPath={activeGallery?.path}
            isGalleryRoot={true}
            currentPath={currentPath}
            highlightedPath={highlightedPath}
            setHighlightedPath={setHighlightedPath}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            filterType={filterType}
            setFilterType={setFilterType}
            totalItems={totalItems}
            totalImages={totalImages}
            totalVideos={totalVideos}
            totalAudio={totalAudio}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filteredFiles={filteredFiles}
            loading={loading}
            scanFolder={scanFolder}
            pendingHighlight={pendingHighlight}
            setPendingHighlight={setPendingHighlight}
          />
        ) : view === 'settings' ? (
          <SettingsPage
            galleries={galleries}
            setGalleries={setGalleries}
            busyGalleryIds={busyGalleryIds}
            setBusyGalleryIds={setBusyGalleryIds}
          />
        ) : view === 'editor' ? (
          selectedFile ? (
            <ImageEditor
              file={selectedFile}
              onClose={() => {
                if (previousView === 'player') {
                  setView('player');
                } else {
                  setHighlightedPath(selectedFile.path);
                  setView('browser');
                }
              }}
              onSaveSuccess={handleFileSaved}
              galleryRoot={activeGallery?.path}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              <p>{t('common.select_file')}</p>
            </div>
          )
        ) : view === 'video_editor' ? (
          <VideoEditor
            file={selectedFile}
            galleryRoot={activeGallery?.path}
            onClose={() => {
              if (previousView === 'player') {
                setView('player');
              } else {
                if (selectedFile) setHighlightedPath(selectedFile.path);
                setView('browser');
              }
            }}
            onSaveSuccess={handleFileSaved}
          />
        ) : view === 'video_converter' ? (
          <VideoConverter
            onClose={() => {
              setView('browser');
            }}
          />
        ) : null}

        {/* Player */}
        <AnimatePresence>
          {view === 'player' && selectedFile && (
            <MediaPlayer
              file={selectedFile}
              galleryRoot={activeGallery?.path || ''}
              onClose={() => {
                setHighlightedPath(selectedFile.path);
                setView('browser');
              }}
              onNext={() => {
                const idx = filteredFiles.findIndex(f => f.path === selectedFile.path);
                for (let i = idx + 1; i < filteredFiles.length; i++) {
                  if (filteredFiles[i].file_type !== 'folder') {
                    setSelectedFile(filteredFiles[i]);
                    return;
                  }
                }
                const totalPages = Math.ceil(totalItems / 100);
                if (currentPage < totalPages) {
                  setPendingPlayerSelect('first');
                  setCurrentPage(prev => prev + 1);
                }
              }}
              onPrev={() => {
                const idx = filteredFiles.findIndex(f => f.path === selectedFile.path);
                for (let i = idx - 1; i >= 0; i--) {
                  if (filteredFiles[i].file_type !== 'folder') {
                    setSelectedFile(filteredFiles[i]);
                    return;
                  }
                }
                if (currentPage > 1) {
                  setPendingPlayerSelect('last');
                  setCurrentPage(prev => prev - 1);
                }
              }}
              hasNext={
                filteredFiles.slice(filteredFiles.findIndex(f => f.path === selectedFile.path) + 1).some(f => f.file_type !== 'folder')
                || currentPage < Math.ceil(totalItems / 100)
              }
              hasPrev={
                filteredFiles.slice(0, filteredFiles.findIndex(f => f.path === selectedFile.path)).some(f => f.file_type !== 'folder')
                || currentPage > 1
              }
              onDelete={handleDeleteFile}
              onInfo={() => setShowInfoModal(true)}
              onEdit={() => openInEditor(selectedFile)}
              onCopy={handleCopyFile}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfoModal && selectedFile && (
          <MediaInfoModal
            file={selectedFile}
            galleryRoot={activeGallery?.path || ''}
            onClose={() => setShowInfoModal(false)}
            onUpdate={handleFileUpdate}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {fileToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="browser-modal-overlay"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="browser-modal-content delete-modal"
            >
              <div className="browser-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444' }}>
                  <Trash2 size={20} />
                  <h3 className="browser-modal-title">{t('modal.delete_title')}</h3>
                </div>
                <button onClick={() => setFileToDelete(null)} className="browser-modal-close-btn"><X size={20} /></button>
              </div>

              <div className="modal-body delete-modal-body" style={{ padding: '24px' }}>
                <p className="delete-desc">
                  {t(fileToDelete.file_type === 'folder' ? 'modal.delete_folder_desc' : 'modal.delete_file_desc', {
                    filename: fileToDelete.filename
                  })}
                </p>

                <div className="deletion-settings" style={{ marginTop: '1rem', position: 'relative' }}>
                  <label className="input-label" style={{ display: 'block', marginBottom: '8px', textAlign: 'left' }}>
                    {t('settings.delete_method_label')}
                  </label>

                  <div
                    className="custom-select-trigger modal-input"
                    onClick={() => setShowDeletionMenu(!showDeletionMenu)}
                  >
                    <span>{t(`settings.delete_${{ DoD3: 'dod', DoD7: 'dod_7' }[deletionMethod] || deletionMethod.toLowerCase()}`)}</span>
                    <ChevronDown size={16} className={`select-arrow ${showDeletionMenu ? 'open' : ''}`} />
                  </div>

                  <AnimatePresence>
                    {showDeletionMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        className="custom-select-menu"
                        style={{ bottom: 'calc(100% + 8px)', top: 'auto' }}
                      >
                        {['Trash', 'Standard', 'Fast', 'Random', 'DoD3', 'DoD7', 'NSA', 'NAVSO', 'VSITR', 'Gutmann'].map(method => (
                          <div
                            key={method}
                            className={`custom-select-item ${deletionMethod === method ? 'active' : ''}`}
                            onClick={() => {
                              setDeletionMethod(method);
                              setShowDeletionMenu(false);
                            }}
                          >
                            {t(`settings.delete_${{ DoD3: 'dod', DoD7: 'dod_7' }[method] || method.toLowerCase()}`)}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="browser-modal-footer" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  onClick={() => setFileToDelete(null)}
                  disabled={isDeleting}
                  className="browser-btn-cancel"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                  className="browser-btn-delete"
                >
                  {isDeleting ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    t('modal.yes_delete')
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Move/Copy Modal */}
      {itemToMoveCopy && (
        <FolderPickerModal
          isOpen={!!itemToMoveCopy}
          onClose={() => setItemToMoveCopy(null)}
          onSelect={handleMoveCopySelect}
          initialPath={currentPath || activeGallery?.path || ''}
          galleryRoot={activeGallery?.path || ''}
          title={t('card.copy_move_title', { filename: itemToMoveCopy.filename })}
          isLoading={isProcessingAction}
        />
      )}

      {/* Global Toast System */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className={`toast ${toast.type === 'success' ? 'toast-success' : (toast.type === 'error' ? 'toast-error' : 'toast-info')}`}
            >
              {toast.type === 'success' && <div className="toast-icon"><CheckCircle size={14} /></div>}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function useAppState() {
  const [activeTab, setActiveTab] = useState('all');
  const [galleries, setGalleries] = useState<Gallery[]>(() => {
    const saved = localStorage.getItem('app_galleries');
    return saved ? JSON.parse(saved) : [];
  });
  const [view, setView] = useState<'browser' | 'editor' | 'video_editor' | 'video_converter' | 'settings' | 'player'>(
    galleries.length > 0 ? 'browser' : 'settings'
  );
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(() => {
    const saved = localStorage.getItem('app_galleries');
    const list = saved ? JSON.parse(saved) : [];
    return list.length > 0 ? list[0].id : null;
  });

  useEffect(() => {
    if (activeGalleryId && !galleries.find(g => g.id === activeGalleryId)) {
      setActiveGalleryId(galleries.length > 0 ? galleries[0].id : null);
      setCurrentPath(null);
      setView(galleries.length > 0 ? 'browser' : 'settings');
    }
  }, [galleries, activeGalleryId]);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<'first' | 'last' | null>(null);
  const [pendingPlayerSelect, setPendingPlayerSelect] = useState<'first' | 'last' | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'date' | 'size'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [totalItems, setTotalItems] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [totalVideos, setTotalVideos] = useState(0);
  const [totalAudio, setTotalAudio] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [busyGalleryIds, setBusyGalleryIds] = useState<string[]>([]);
  const { t } = useLanguage();

  return {
    activeTab, setActiveTab, view, setView, selectedFile, setSelectedFile,
    files, setFiles, t, galleries, setGalleries,
    activeGalleryId, setActiveGalleryId,
    currentPath, setCurrentPath, highlightedPath, setHighlightedPath,
    currentPage, setCurrentPage, sortBy, setSortBy, sortOrder, setSortOrder,
    filterType, setFilterType, totalItems, setTotalItems,
    searchQuery, setSearchQuery, busyGalleryIds, setBusyGalleryIds,
    loading, setLoading, pendingHighlight, setPendingHighlight,
    pendingPlayerSelect, setPendingPlayerSelect,
    totalImages, setTotalImages,
    totalVideos, setTotalVideos,
    totalAudio, setTotalAudio
  };
}

function App() {
  return (
    <LanguageProvider>
      <TitleBar />
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
