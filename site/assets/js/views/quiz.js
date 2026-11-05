import { esc } from '../charts/svg.js';

const pad = (n) => String(n).padStart(2, '0');

export function quizView(root, app) {
  const { t, model, store } = app;
  const dims = model.dimensions;
  const questions = model.questions;
  const sections = dims.map((dim) => questions.map((q, i) => ({ q, i })).filter(({ q }) => q.dim === dim.id));
  const draft = store.draft();
  const answers = Array(questions.length).fill(null);
  (draft?.answers ?? []).slice(0, questions.length).forEach((a, i) => {
    answers[i] = a;
  });
  const finishes = draft?.finishes ?? null;
  let section = draft?.section ?? sections.findIndex((items) => items.some(({ i }) => !answers[i]));
  if (section < 0 || section >= sections.length) section = 0;

  const remaining = () => sections[section].filter(({ i }) => !answers[i]).length;
  const answeredCount = () => answers.filter(Boolean).length;
  const persist = () => store.saveDraft({ answers, section, finishes });

  const progress = () => {
    const n = answeredCount();
    return `
    <div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="${n}" aria-label="${esc(t('quiz.progressLabel'))}">
      ${sections
        .map((items, s) => `<span class="quiz-chunk ${s === section ? 'is-current' : ''}">${items.map(({ i }) => `<i class="${answers[i] ? 'on' : ''}"></i>`).join('')}</span>`)
        .join('')}
    </div>
    <p class="quiz-count">${esc(t('quiz.progress', { n, total: questions.length }))}</p>`;
  };

  const render = () => {
    const last = section === sections.length - 1;
    root.innerHTML = `
    <header class="page-head quiz-head">
      <h1>${esc(t('quiz.title'))}</h1>
      <p class="deck">${esc(t('quiz.intro'))}</p>
      <div data-progress>${progress()}</div>
    </header>
    <form class="quiz-form" novalidate>
      <h2 class="quiz-section" tabindex="-1">${esc(t('quiz.section', { n: section + 1, name: dims[section].name[t.lang] }))}</h2>
      ${sections[section]
        .map(({ q, i }) => `
        <fieldset class="q ${answers[i] ? 'is-done' : ''}" data-q="${i}">
          <legend><span class="q-no">Q${pad(q.no)}.</span> ${esc(q[t.lang])}</legend>
          <div class="scale">
            ${model.scale[t.lang]
              .map((label, k) => `
              <label class="opt">
                <input type="radio" name="q${i}" value="${k + 1}" ${answers[i] === k + 1 ? 'checked' : ''}>
                <span class="opt-box"><b>${k + 1}</b><span>${esc(label)}</span></span>
              </label>`)
              .join('')}
          </div>
        </fieldset>`)
        .join('')}
      <div class="quiz-nav">
        ${section > 0 ? `<button type="button" class="text-link" data-prev>${esc(t('quiz.back'))}</button>` : '<span></span>'}
        <div class="quiz-next">
          <p class="quiz-hint" data-hint aria-live="polite"></p>
          <button type="submit" class="cta" data-next>${esc(last ? t('quiz.finish') : t('quiz.next'))}</button>
        </div>
      </div>
      <p class="meta">${esc(t('quiz.saved'))}</p>
    </form>`;
    updateHint();
  };

  const updateHint = () => {
    const hint = root.querySelector('[data-hint]');
    const left = remaining();
    if (hint) hint.textContent = left ? t('quiz.needAll', { n: left }) : '';
    root.querySelector('[data-next]')?.setAttribute('aria-disabled', left ? 'true' : 'false');
  };

  const goTo = (next) => {
    section = next;
    persist();
    render();
    window.scrollTo({ top: 0 });
    root.querySelector('.quiz-section')?.focus({ preventScroll: true });
  };

  root.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.matches('input[type=radio]')) return;
    const index = Number(input.name.slice(1));
    const first = !answers[index];
    answers[index] = Number(input.value);
    persist();
    root.querySelector('[data-progress]').innerHTML = progress();
    input.closest('fieldset').classList.add('is-done');
    updateHint();
    // Bring the next unanswered statement into view, without moving keyboard focus.
    if (first) {
      const next = root.querySelector('fieldset.q:not(.is-done)') ?? root.querySelector('.quiz-nav');
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      const box = next.getBoundingClientRect();
      if (box.top < 90 || box.bottom > window.innerHeight - 20) {
        window.scrollBy({ top: box.top - Math.max(100, window.innerHeight * 0.22), behavior: motion });
      }
    }
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-prev]')) goTo(section - 1);
  });

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (remaining()) {
      const first = root.querySelector('fieldset.q:not(.is-done)');
      first?.scrollIntoView({ block: 'center' });
      first?.querySelector('input')?.focus({ preventScroll: true });
      return;
    }
    if (section < sections.length - 1) {
      goTo(section + 1);
      return;
    }
    const missing = answers.findIndex((a) => !a);
    if (missing >= 0) {
      goTo(sections.findIndex((items) => items.some(({ i }) => i === missing)));
      return;
    }
    if (finishes) store.deleteResult(finishes);
    const result = store.addResult(answers, model.version);
    app.navigate(`#/results?r=${result.id}`);
  });

  render();
}
