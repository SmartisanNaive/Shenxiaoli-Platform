import { api, escapeHtml, jsonBody, showToast } from './api';

export async function initRecoverySettings(root: HTMLElement): Promise<void> {
  const section = root.querySelector<HTMLElement>('[data-recovery-settings]');
  if (!section) return;
  try {
    const state = await api<{ email: string | null }>(
      '/api/auth/recovery-email',
    );
    const inputClass =
      'rounded-lg border border-outline-variant bg-surface px-3 py-2';
    section.innerHTML = `<h3 class="font-headline-sm text-primary">辅助邮箱与账号恢复</h3><p class="mt-2 text-body-sm text-on-surface-variant">${state.email ? `已绑定：${escapeHtml(state.email)}` : '尚未绑定辅助邮箱。'} 账号邮箱无法使用时，可通过已绑定的辅助邮箱登录原账号。</p><p class="mt-2 text-xs text-outline">首次绑定需验证账号邮箱和新辅助邮箱。修改或解绑后会退出所有设备，请重新登录。</p><form class="mt-4 grid gap-3" data-recovery-settings-form><label class="grid gap-1 text-label-sm">${state.email ? '新的辅助邮箱' : '辅助邮箱'}<input name="email" type="email" autocomplete="email" class="${inputClass}" placeholder="可长期使用的邮箱，例如 QQ 邮箱" /></label><label class="grid gap-1 text-label-sm">确认当前账号的方式<select name="method" class="${inputClass}"><option value="campus">账号邮箱验证码</option>${state.email ? '<option value="auxiliary">已绑定的辅助邮箱验证码</option>' : ''}</select></label><div class="flex flex-wrap gap-2"><button type="button" data-recovery-bind class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">${state.email ? '验证并修改辅助邮箱' : '发送绑定验证码'}</button>${state.email ? '<button type="button" data-recovery-remove class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-error">发送解绑验证码</button>' : ''}</div><div data-recovery-proof hidden class="grid gap-3"><p data-recovery-purpose class="text-body-sm text-on-surface-variant"></p><label class="grid gap-1 text-label-sm">当前邮箱验证码<input name="currentOtp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" class="${inputClass}" /></label><label data-recovery-new-proof class="grid gap-1 text-label-sm">新辅助邮箱验证码<input name="newOtp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="${inputClass}" /></label><div class="flex gap-2"><button data-recovery-confirm class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">确认设置</button><button type="button" data-recovery-cancel class="rounded-lg border border-outline-variant px-4 py-2 text-label-sm">取消</button></div></div></form>`;
    const form = section.querySelector<HTMLFormElement>('form')!;
    const emailInput = form.elements.namedItem('email') as HTMLInputElement;
    const methodInput = form.elements.namedItem('method') as HTMLSelectElement;
    const currentOtp = form.elements.namedItem(
      'currentOtp',
    ) as HTMLInputElement;
    const newOtp = form.elements.namedItem('newOtp') as HTMLInputElement;
    const proof = section.querySelector<HTMLElement>('[data-recovery-proof]')!;
    const purpose = section.querySelector<HTMLElement>(
      '[data-recovery-purpose]',
    )!;
    const newProof = section.querySelector<HTMLElement>(
      '[data-recovery-new-proof]',
    )!;
    let pending: {
      challengeId: string;
      operation: 'change' | 'remove';
    } | null = null;
    let busy = false;
    const lock = (value: boolean) => {
      busy = value;
      form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.disabled = value;
      });
    };
    const reset = () => {
      pending = null;
      proof.hidden = true;
      emailInput.readOnly = false;
      methodInput.disabled = false;
      currentOtp.required = false;
      newOtp.required = false;
      currentOtp.value = '';
      newOtp.value = '';
    };
    const request = async (operation: 'change' | 'remove') => {
      if (busy) return;
      const email = emailInput.value.trim().toLowerCase();
      if (operation === 'change' && (!email || !emailInput.checkValidity())) {
        showToast('请填写有效的辅助邮箱。', 'error');
        emailInput.focus();
        return;
      }
      lock(true);
      try {
        const result = await api<{ challengeId: string }>(
          `/api/auth/recovery-email/${operation}/request`,
          {
            method: 'POST',
            body: jsonBody({ email, method: methodInput.value }),
          },
        );
        pending = { challengeId: result.challengeId, operation };
        proof.hidden = false;
        newProof.hidden = operation === 'remove';
        currentOtp.required = true;
        newOtp.required = operation === 'change';
        currentOtp.value = '';
        newOtp.value = '';
        emailInput.readOnly = true;
        methodInput.disabled = true;
        purpose.textContent =
          operation === 'change'
            ? `请输入当前邮箱及 ${email} 收到的两个验证码。`
            : '请输入当前验证邮箱收到的解绑验证码。';
        showToast('验证码已发送，5 分钟内有效。', 'success');
        currentOtp.focus();
      } catch (error) {
        showToast(error instanceof Error ? error.message : '发送失败', 'error');
      } finally {
        lock(false);
      }
    };
    section
      .querySelector('[data-recovery-bind]')
      ?.addEventListener('click', () => void request('change'));
    section
      .querySelector('[data-recovery-remove]')
      ?.addEventListener('click', () => void request('remove'));
    section
      .querySelector('[data-recovery-cancel]')
      ?.addEventListener('click', reset);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!pending || busy) return;
      lock(true);
      try {
        await api(`/api/auth/recovery-email/${pending.operation}/confirm`, {
          method: 'POST',
          body: jsonBody({
            challengeId: pending.challengeId,
            currentOtp: currentOtp.value.trim(),
            otp: currentOtp.value.trim(),
            newOtp: newOtp.value.trim(),
          }),
        });
        showToast('辅助邮箱设置已更新，请重新登录。', 'success');
        window.location.href = './index.html';
      } catch (error) {
        showToast(error instanceof Error ? error.message : '验证失败', 'error');
      } finally {
        lock(false);
      }
    });
  } catch (error) {
    section.textContent =
      error instanceof Error ? error.message : '辅助邮箱设置加载失败。';
  }
}
