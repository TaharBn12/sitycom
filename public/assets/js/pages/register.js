import { initI18n, setLang, getLang, LANGS, t } from '../i18n.js';
import { api, setToken, getToken } from '../api.js';
import { el, toast } from '../ui.js';

initI18n();

// لغة
const box = document.getElementById('lang-box');
LANGS.forEach((l) => {
  box.appendChild(el('button', {
    class: `btn btn-sm ${getLang() === l.code ? 'btn-primary' : ''}`,
    text: l.label,
    onclick: () => { setLang(l.code); location.reload(); },
  }));
});

// جلسة سارية → لوحة التحكم
if (getToken()) {
  api.me().then(() => { location.href = 'index.html'; }).catch(() => {});
}

const form = document.getElementById('register-form');
const btn = document.getElementById('register-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;

  if (password.length < 6) return toast(t('register.short'), 'error');
  if (password !== confirm) return toast(t('register.mismatch'), 'error');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res = await api.register({ username, name, password, confirm_password: confirm });
    setToken(res.token, res.user);
    toast(t('common.success'), 'success');
    location.href = 'index.html';
  } catch (err) {
    toast(err.message || t('common.error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('register.submit');
  }
});
