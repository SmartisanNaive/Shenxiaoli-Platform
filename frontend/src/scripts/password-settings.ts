import { api, escapeHtml, jsonBody } from './api';

export function renderPasswordForm(email = ''): string {
  const inputClass =
    'mt-1 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-body-sm';
  return `<form data-password-form class="mt-3 grid gap-3" novalidate>
    <label class="text-label-sm">账号邮箱<input name="email" type="email" autocomplete="email" required ${email ? 'readonly' : ''} value="${escapeHtml(email)}" class="${inputClass}" placeholder="账号登录邮箱" /></label>
    <div data-password-proof hidden class="grid gap-3">
      <label class="text-label-sm">邮箱验证码<input name="otp" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" class="${inputClass}" placeholder="6 位验证码" /></label>
      <label class="text-label-sm">新密码<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" class="${inputClass}" placeholder="8–128 位密码" /></label>
      <label class="text-label-sm">确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128" class="${inputClass}" placeholder="再次输入新密码" /></label>
    </div>
    <p data-password-status role="status" class="text-xs leading-5 text-on-surface-variant"></p>
    <p data-password-error role="alert" class="text-xs leading-5 text-error"></p>
    <button data-password-send type="submit" class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary">获取验证码</button>
    <button data-password-confirm type="submit" hidden class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary">确认设置密码</button>
    <button data-password-resend type="button" hidden class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm text-primary">重新发送验证码</button>
  </form>`;
}

export function initPasswordForm(
  root: HTMLElement,
  options: {
    onBusy?: (busy: boolean) => void;
    onSuccess: (email: string) => void;
  },
) {
  const form = root.querySelector<HTMLFormElement>('[data-password-form]')!;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const otp = form.elements.namedItem('otp') as HTMLInputElement;
  const password = form.elements.namedItem('password') as HTMLInputElement;
  const confirm = form.elements.namedItem(
    'confirmPassword',
  ) as HTMLInputElement;
  const proof = form.querySelector<HTMLElement>('[data-password-proof]')!;
  const send = form.querySelector<HTMLButtonElement>('[data-password-send]')!;
  const verify = form.querySelector<HTMLButtonElement>(
    '[data-password-confirm]',
  )!;
  const resend = form.querySelector<HTMLButtonElement>(
    '[data-password-resend]',
  )!;
  const status = form.querySelector<HTMLElement>('[data-password-status]')!;
  const error = form.querySelector<HTMLElement>('[data-password-error]')!;
  let pendingEmail = '';
  let busy = false;
  const reset = (): void => {
    pendingEmail = '';
    otp.value = password.value = confirm.value = '';
    confirm.setCustomValidity('');
    proof.hidden = verify.hidden = resend.hidden = true;
    send.hidden = false;
    status.textContent = error.textContent = '';
  };
  const setBusy = (value: boolean): void => {
    busy = value;
    form
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
      .forEach((control) => {
        control.disabled = value;
      });
    options.onBusy?.(value);
  };
  const request = async (): Promise<void> => {
    if (busy) return;
    email.value = email.value.trim();
    if (!email.reportValidity()) return;
    const target = email.value.toLowerCase();
    reset();
    setBusy(true);
    try {
      await api('/api/auth/email-otp/request-password-reset', {
        method: 'POST',
        body: jsonBody({ email: target }),
      });
      pendingEmail = target;
      proof.hidden = verify.hidden = resend.hidden = false;
      send.hidden = true;
      status.textContent =
        '如果该邮箱对应的账号可用，验证码将发送至该账号邮箱。设置成功后需在所有设备重新登录。';
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : '验证码发送失败，请重试。';
    } finally {
      setBusy(false);
      if (pendingEmail) otp.focus();
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!pendingEmail) {
      await request();
      return;
    }
    confirm.setCustomValidity(
      password.value === confirm.value ? '' : '两次输入的密码不一致。',
    );
    if (![otp, password, confirm].every((input) => input.reportValidity()))
      return;
    error.textContent = '';
    setBusy(true);
    let completedEmail = '';
    try {
      const target = pendingEmail;
      await api('/api/auth/email-otp/reset-password', {
        method: 'POST',
        body: jsonBody({
          email: target,
          otp: otp.value.trim(),
          password: password.value,
        }),
      });
      reset();
      completedEmail = target;
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : '密码设置失败，请重试。';
    } finally {
      setBusy(false);
    }
    if (completedEmail) options.onSuccess(completedEmail);
  });
  resend.addEventListener('click', () => {
    void request();
  });
  email.addEventListener('input', reset);
  confirm.addEventListener('input', () => confirm.setCustomValidity(''));
  password.addEventListener('input', () => confirm.setCustomValidity(''));
  reset();
  return { reset, focus: () => email.focus() };
}
