import { api, jsonBody, showToast } from './api';

export function initInformation(): void {
  const form = document.querySelector<HTMLFormElement>('[data-feedback-form]');
  const emailWrap = document.querySelector<HTMLElement>(
    '[data-feedback-email-wrap]',
  );
  if (!form) return;
  void api<{ authenticated: boolean; user: { email?: string } | null }>(
    '/api/session',
  )
    .then((state) => {
      if (state.authenticated && emailWrap) emailWrap.classList.add('hidden');
    })
    .catch(() => undefined);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    try {
      await api('/api/feedback', {
        method: 'POST',
        body: jsonBody({
          subject: data.get('subject'),
          message: data.get('message'),
          email: data.get('email'),
        }),
      });
      form.reset();
      showToast('反馈已提交，感谢帮助改进社区。', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '反馈提交失败',
        'error',
      );
    } finally {
      if (button) button.disabled = false;
    }
  });
}
