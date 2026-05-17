import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Global keyboard shortcut handler.
 * Binds shortcuts that do not conflict with browser defaults.
 */
export function useKeyboard() {
  const editMode = useStore(s => s.editMode);
  const setEditMode = useStore(s => s.setEditMode);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const saveToServer = useStore(s => s.saveToServer);
  const deleteElement = useStore(s => s.deleteElement);
  const selectedMapId = useStore(s => s.selectedMapId);
  const selectedElementId = useStore(s => s.selectedElementId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when typing in an input / textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Ctrl / Cmd combos
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          saveToServer().catch(console.error);
          return;
        }
        return;
      }

      // Single-key mode switches
      switch (e.key) {
        case 's':
        case 'S':
          setEditMode('select');
          break;
        case 'l':
        case 'L':
          setEditMode('draw-line');
          break;
        case 'p':
        case 'P':
          setEditMode('draw-polygon');
          break;
        case 'x':
        case 'X':
          setEditMode('delete');
          break;
        case 'Escape':
          setEditMode('select');
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedMapId && selectedElementId) {
            e.preventDefault();
            deleteElement(selectedMapId, selectedElementId);
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editMode, setEditMode, undo, redo, saveToServer, deleteElement, selectedMapId, selectedElementId]);
}
