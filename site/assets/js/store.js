// Saved results live only in this browser. Nothing is ever sent anywhere.
// Results keep the raw answers, not derived scores, so they can be re-scored against
// whatever party data is current when the person comes back.

const KEY = 'gic.v1';
const MAX_RESULTS = 50;
const EMPTY = () => ({ results: [], activeId: null, draft: null, scope: 'all' });

let memory = null; // used when storage is blocked, so the current visit still works
let persistent = true;

function isValidResult(r) {
  return (
    r && typeof r.id === 'string' && typeof r.at === 'string' && Array.isArray(r.answers) && r.answers.length === 20 &&
    r.answers.every((a) => Number.isInteger(a) && a >= 1 && a <= 5)
  );
}

function read() {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY();
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY(),
      ...parsed,
      results: Array.isArray(parsed.results) ? parsed.results.filter(isValidResult) : [],
    };
  } catch {
    persistent = false;
    return EMPTY();
  }
}

function write(state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    memory = null;
    persistent = true;
  } catch {
    memory = state;
    persistent = false;
  }
}

function update(fn) {
  const state = read();
  fn(state);
  write(state);
  return state;
}

export const store = {
  /** False when the browser refuses storage: results will last for this visit only. */
  isPersistent: () => {
    read();
    return persistent;
  },
  results: () => read().results,
  active() {
    const { results, activeId } = read();
    return results.find((r) => r.id === activeId) ?? results[results.length - 1] ?? null;
  },
  get: (id) => read().results.find((r) => r.id === id) ?? null,
  setActive: (id) => update((s) => void (s.activeId = id)),
  addResult(answers, version) {
    const result = { id: `r${Date.now().toString(36)}`, at: new Date().toISOString(), answers: [...answers], version };
    update((s) => {
      s.results.push(result);
      s.results = s.results.slice(-MAX_RESULTS);
      s.activeId = result.id;
      s.draft = null;
    });
    return result;
  },
  deleteResult: (id) =>
    update((s) => {
      s.results = s.results.filter((r) => r.id !== id);
      if (s.activeId === id) s.activeId = s.results[s.results.length - 1]?.id ?? null;
    }),
  clearAll() {
    memory = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      memory = EMPTY();
    }
  },
  draft: () => read().draft,
  saveDraft: (draft) => update((s) => void (s.draft = draft)),
  clearDraft: () => update((s) => void (s.draft = null)),
  scope: () => read().scope ?? 'all',
  setScope: (scope) => update((s) => void (s.scope = scope)),
};
