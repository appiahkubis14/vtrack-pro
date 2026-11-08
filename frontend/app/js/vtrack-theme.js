/**
 * Applies the saved colour theme before the page paints, so there is no light flash in dark mode.
 * Load this in <head>, before the stylesheets.  "light" and "dark" are explicit choices; with no
 * choice saved the operating system preference is followed.
 */
(function () {
  const KEY = 'vtrack-theme';
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the choice lasts for this page only */ } };
  const system = () => (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const effective = () => { const s = read(); return s === 'light' || s === 'dark' ? s : system(); };

  function apply() {
    const t = effective();
    document.documentElement.setAttribute('data-bs-theme', t);
    document.documentElement.style.colorScheme = t;
    return t;
  }
  apply();

  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (!read()) { apply(); document.dispatchEvent(new CustomEvent('vtrack-theme', { detail: effective() })); } };
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  }

  window.VTrackTheme = {
    get: effective,
    set(v) { write(v); apply(); document.dispatchEvent(new CustomEvent('vtrack-theme', { detail: effective() })); },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } apply(); document.dispatchEvent(new CustomEvent('vtrack-theme', { detail: effective() })); },
    toggle() { this.set(effective() === 'dark' ? 'light' : 'dark'); },
  };
})();
