(() => {
  const y = document.getElementById("y");
  if (y) y.textContent = String(new Date().getFullYear());
})();

const triggers = document.querySelectorAll('.nav-dropdown-trigger');

function positionMenuPanel(btn, menu) {
  if (!btn || !menu || menu.hidden) return;
  menu.style.position = "fixed";
  const rect = btn.getBoundingClientRect();
  const panelW = menu.offsetWidth || 176;
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - panelW - 12));
  menu.style.left = Math.round(left) + "px";
  menu.style.top = Math.round(rect.bottom + 6) + "px";
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

let activeMenu = null;
let activeBtn = null;

function closeActiveMenu() {
  if (!activeMenu || !activeBtn) return;
  activeMenu.classList.remove("dropdown--open");
  activeBtn.setAttribute("aria-expanded", "false");
  activeMenu.hidden = true;
  activeMenu.style.removeProperty("left");
  activeMenu.style.removeProperty("top");
  activeMenu.style.removeProperty("position");
  activeMenu = null;
  activeBtn = null;
}

function openMenu(btn, menu) {
  if (activeMenu && activeMenu !== menu) {
    closeActiveMenu();
  }

  menu.hidden = false;
  menu.classList.remove("dropdown--open");

  positionMenuPanel(btn, menu);

  const finishOpen = () => {
    positionMenuPanel(btn, menu);
    menu.classList.add("dropdown--open");
    btn.setAttribute("aria-expanded", "true");
    activeMenu = menu;
    activeBtn = btn;
  };

  if (prefersReducedMotion()) {
    finishOpen();
  } else {
    menu.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(finishOpen));
  }
}

function toggleMenu(btn, menu) {
  if (!menu.hidden && menu.classList.contains("dropdown--open")) {
    closeActiveMenu();
    return;
  }
  openMenu(btn, menu);
}

triggers.forEach(btn => {
  const targetId = btn.id.replace('-btn', '');
  const menu = document.getElementById(targetId);
  if (!menu) return;

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleMenu(btn, menu);
  }, true);

  menu.querySelectorAll('[role="menuitem"]').forEach((link) => {
    link.addEventListener("click", closeActiveMenu);
  });
});

document.addEventListener("click", (e) => {
  if (!activeMenu) return;
  const target = e.target instanceof Node ? e.target : null;
  if (!target || activeMenu.contains(target) || activeBtn.contains(target)) return;
  closeActiveMenu();
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeActiveMenu();
});

document.addEventListener("scroll", () => {
  if (activeMenu && activeBtn) positionMenuPanel(activeBtn, activeMenu);
}, true);

window.addEventListener("resize", () => {
  if (activeMenu && activeBtn) positionMenuPanel(activeBtn, activeMenu);
});

const carousel = document.querySelector('.carousel__track');
const prevBtn = document.querySelector('.carousel__arrow--prev');
const nextBtn = document.querySelector('.carousel__arrow--next');

function scrollCarousel(dir) {
  if (!carousel) return;
  const gapStr = getComputedStyle(carousel).gap;
  const gap = Number.parseFloat(gapStr) || 20;
  const card = carousel.querySelector('.plan-card');
  const amount = card ? card.getBoundingClientRect().width + gap : 320;
  carousel.scrollBy({ left: dir * amount, behavior: "smooth" });
}

if (prevBtn) prevBtn.addEventListener("click", () => scrollCarousel(-1));
if (nextBtn) nextBtn.addEventListener("click", () => scrollCarousel(1));

// Dynamic Plans Rendering
async function fetchAndRenderPlans() {
  const containers = document.querySelectorAll('.dynamic-plans');
  if (containers.length === 0) return;

  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    if (!data.plans) return;

    containers.forEach(container => {
      const typeFilter = container.getAttribute('data-plan-type'); // e.g. VPS, RDP, GAME
      const gameFilter = container.getAttribute('data-plan-game'); // e.g. Minecraft, SA-MP
      const tierFilter = container.getAttribute('data-plan-tier'); // e.g. Budget, Extreme
      
      let filteredPlans = data.plans;
      if (typeFilter) {
        filteredPlans = filteredPlans.filter(p => p.type.toUpperCase() === typeFilter.toUpperCase());
      }
      if (gameFilter) {
        filteredPlans = filteredPlans.filter(p => p.game_name && p.game_name.toUpperCase() === gameFilter.toUpperCase());
      }
      if (tierFilter) {
        filteredPlans = filteredPlans.filter(p => p.tier && p.tier.toUpperCase() === tierFilter.toUpperCase());
      }

      if (filteredPlans.length === 0) {
        container.innerHTML = '<p style="text-align:center; width:100%; color:#666;">No plans available in this category.</p>';
        return;
      }

      container.innerHTML = filteredPlans.map(plan => `
        <div class="tier-card">
          <h3>${plan.name}</h3>
          <p class="tier-price">$${parseFloat(plan.price).toFixed(2)}<small>/ ${plan.billing_cycle || 'month'}</small></p>
          <ul class="tier-list">
            ${plan.description ? `<li>${plan.description}</li>` : ''}
          </ul>
          <a class="btn btn--header-accent" href="../cart.html?plan=${plan.id}">Order Now</a>
        </div>
      `).join('');
    });
  } catch (err) {
    console.error('Failed to fetch plans:', err);
    containers.forEach(container => {
      container.innerHTML = '<p style="text-align:center; width:100%; color:#ef4444;">Failed to load plans. Please try again later.</p>';
    });
  }
}

document.addEventListener('DOMContentLoaded', fetchAndRenderPlans);
