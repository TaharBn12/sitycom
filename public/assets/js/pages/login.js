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

// إذا كانت الجلسة سارية
if (getToken()) {
  api.me().then(() => { location.href = 'index.html'; }).catch(() => {});
}

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res = await api.login(username, password);
    setToken(res.token, res.user);
    toast(t('common.success'), 'success');
    location.href = 'index.html';
  } catch (err) {
    toast(err.message || t('login.failed'), 'error');
    btn.disabled = false;
    btn.textContent = t('login.submit');
  }
});
