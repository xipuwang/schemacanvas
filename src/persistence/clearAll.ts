/**
 * Remove every copy of project data this browser holds: the IndexedDB records (autosave, recent projects), the
 * localStorage write-ahead journal and the per-project view state. Preference keys (theme, language, panel sizes) stay.
 * Pending autosave writes are cancelled first so they cannot re-create what is being removed.
 */
import { discardPending } from './autosave';
import { idbKv, type KvStore } from './idb';
import { clearJournal } from './journal';
import { clearChecked } from './storage';
import { clearViewState } from './viewState';

/** Resolves to whether the IndexedDB records were really removed (the journal and view state are always attempted). */
export async function clearAllProjectData(kv: KvStore = idbKv): Promise<boolean> {
  await discardPending();
  const ok = await clearChecked(kv);
  clearJournal();
  clearViewState();
  return ok;
}
