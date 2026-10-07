import { useCallback, useState } from "react";

export function useHistory(initial = null, limit = 60) {
  const [timeline, setTimeline] = useState({ past: [], present: initial, future: [] });
  const reset = useCallback((present) => setTimeline({ past: [], present, future: [] }), []);
  const commit = useCallback((present) => setTimeline((current) => ({
    past: [...current.past, current.present].filter(Boolean).slice(-limit), present, future: [],
  })), [limit]);
  const undo = useCallback(() => setTimeline((current) => current.past.length ? {
    past: current.past.slice(0, -1), present: current.past.at(-1), future: [current.present, ...current.future],
  } : current), []);
  const redo = useCallback(() => setTimeline((current) => current.future.length ? {
    past: [...current.past, current.present].slice(-limit), present: current.future[0], future: current.future.slice(1),
  } : current), [limit]);
  return { project: timeline.present, commit, reset, undo, redo, canUndo: Boolean(timeline.past.length), canRedo: Boolean(timeline.future.length) };
}
