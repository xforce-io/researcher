/* eslint-env browser */
/** Shared document controls. Dialog is outside the reading layout. */
const root = document.querySelector('.document-detail');
const dialog = root?.querySelector('.document-topic-dialog');
const open = root?.querySelector('[data-open-topics]');
const feedback = root?.querySelector('.document-feedback');
const messageKey = `document-feedback:${location.pathname}`;
const focusKey = `document-topic-focus:${location.pathname}`;
if (feedback) {
  try {
    const message = sessionStorage.getItem(messageKey);
    sessionStorage.removeItem(messageKey);
    if (message) { feedback.textContent = message; feedback.hidden = false; }
  } catch { /* Storage may be disabled; persistence remains server-owned. */ }
}
if (dialog && open) {
  try {
    const restoreFocus = sessionStorage.getItem(focusKey);
    sessionStorage.removeItem(focusKey);
    if (restoreFocus) open.focus();
  } catch { /* Storage may be disabled. */ }
  open.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-close-topics]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.hasAttribute('data-auto-open')) {
      try { sessionStorage.setItem(focusKey, '1'); } catch { /* Optional focus across navigation. */ }
      location.href = location.pathname;
      return;
    }
    open.focus();
  });
  if (dialog.hasAttribute('data-auto-open')) dialog.showModal();
  // Handle only document topic mutations, leaving other JSON forms unchanged.
  dialog.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.jsonAction) return;
    event.preventDefault();
    event.stopPropagation();
    if (form.dataset.saving === '1') return;
    const method = form.dataset.jsonMethod || 'POST';
    if (method === 'DELETE' && !confirm('解除此 topic 关联？')) return;
    form.dataset.saving = '1';
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    let status = form.querySelector('[data-form-status]');
    if (!status) {
      status = document.createElement('p');
      status.dataset.formStatus = '';
      status.setAttribute('role', 'status');
      form.append(status);
    }
    status.textContent = '保存中…';
    const body = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch(form.dataset.jsonAction, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const text = await res.text();
        let reason = text;
        try { const data = JSON.parse(text); reason = data.message || data.error || text; } catch { /* plain response */ }
        throw new Error(reason || String(res.status));
      }
      try { sessionStorage.setItem(messageKey, method === 'DELETE' ? '已解除 topic 关联' : 'topic 关联已保存'); } catch { /* optional feedback */ }
      location.href = location.pathname;
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.className = 'video-error';
      status.textContent = `保存失败，请重试：${error.message || '网络不可用'}`;
      form.dataset.saving = '0';
      buttons.forEach((button) => { button.disabled = false; });
    }
  }, true);
}
const titleForm = root?.querySelector('.video-title-form');
const editTitle = document.getElementById('edit-title');
const titleInput = document.getElementById('video-title');
const originalTitle = titleInput?.value;
editTitle?.addEventListener('click', () => {
  titleForm.hidden = false;
  editTitle.setAttribute('aria-expanded', 'true');
  titleInput.focus();
});
document.getElementById('cancel-title')?.addEventListener('click', () => {
  titleInput.value = originalTitle;
  titleForm.hidden = true;
  document.getElementById('title-error').hidden = true;
  editTitle.setAttribute('aria-expanded', 'false');
  editTitle.focus();
});
