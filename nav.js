/**
 * nav.js — Cole's Election Models
 * Injects the navbar HTML into every page and handles interactivity.
 * Edit NAV_ITEMS below to update the nav across all pages at once.
 * Styles live in styles.css — this file handles structure and behavior only.
 */

(function () {

  // ── Edit this to update the nav on all pages ──────────────────────────────
  const NAV_ITEMS = [
    { label: 'Home', href: 'index.html' },
    {
      label: 'Models',
      children: [
        { label: 'IL-09 Dem Primary Model', href: 'IL09_precinct_map.html' },
      ],
    },
    { label: 'Maps', href: 'maps.html' },
  ];
  // ─────────────────────────────────────────────────────────────────────────

  function chevron() {
    return `<svg class="cem-chevron" viewBox="0 0 20 20" fill="none">
      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // Build desktop menu items
  let desktopItems = '';
  NAV_ITEMS.forEach((item, i) => {
    if (!item.children) {
      desktopItems += `<li><a href="${item.href}">${item.label}</a></li>`;
    } else {
      const links = item.children.map(c => `<a href="${c.href}">${c.label}</a>`).join('');
      desktopItems += `
        <li>
          <button class="cem-toggle" data-idx="${i}">${item.label} ${chevron()}</button>
          <div class="cem-dropdown">${links}</div>
        </li>`;
    }
  });

  // Build mobile menu items
  let mobileItems = '';
  NAV_ITEMS.forEach((item, i) => {
    if (!item.children) {
      mobileItems += `<a href="${item.href}">${item.label}</a>`;
    } else {
      const links = item.children.map(c => `<a href="${c.href}">${c.label}</a>`).join('');
      mobileItems += `
        <button class="cem-mob-toggle" data-mob="${i}">${item.label} ${chevron()}</button>
        <div class="cem-mobile-sub" id="cem-mob-${i}">${links}</div>`;
    }
  });

  // Inject navbar — remove any existing nav first
  document.querySelectorAll('nav').forEach(n => n.remove());
  document.body.insertAdjacentHTML('afterbegin', `
    <nav id="cem-nav">
      <div class="cem-nav-inner">
        <a class="cem-brand" href="index.html">Cole's <span>Election Models</span></a>
        <ul class="cem-menu">${desktopItems}</ul>
        <button class="cem-hamburger" id="cem-hamburger" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
      </div>
      <div class="cem-mobile-menu" id="cem-mobile-menu">${mobileItems}</div>
    </nav>
  `);

  // ── Interactivity ─────────────────────────────────────────────────────────

  // Desktop dropdowns
  document.querySelectorAll('#cem-nav .cem-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const li = btn.closest('li');
      const isOpen = li.classList.contains('cem-open');
      document.querySelectorAll('#cem-nav li.cem-open').forEach(l => l.classList.remove('cem-open'));
      if (!isOpen) li.classList.add('cem-open');
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('#cem-nav li.cem-open').forEach(l => l.classList.remove('cem-open'));
  });

  // Hamburger
  const hamburger = document.getElementById('cem-hamburger');
  const mobileMenu = document.getElementById('cem-mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', e => {
      e.stopPropagation();
      const open = mobileMenu.classList.toggle('cem-open');
      hamburger.classList.toggle('cem-open', open);
    });
  }

  // Mobile sub-menus
  document.querySelectorAll('#cem-nav .cem-mob-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sub = document.getElementById(`cem-mob-${btn.dataset.mob}`);
      if (sub) {
        sub.classList.toggle('cem-open');
        const c = btn.querySelector('.cem-chevron');
        if (c) c.style.transform = sub.classList.contains('cem-open') ? 'rotate(180deg)' : '';
      }
    });
  });

  // Highlight active page
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#cem-nav a').forEach(a => {
    if (a.getAttribute('href') === currentPage) {
      a.style.color = 'var(--text-primary)';
      a.style.fontWeight = '600';
    }
  });

})();