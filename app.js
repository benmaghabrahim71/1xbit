/**
 * Host1Top Unified App Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DROPDOWN LOGIC ---
    const triggers = document.querySelectorAll('.nav-dropdown-trigger');
    let activeMenu = null;
    let activeBtn = null;

    function positionMenuPanel(btn, menu) {
        if (!btn || !menu || menu.hidden) return;
        menu.style.position = "fixed";
        const rect = btn.getBoundingClientRect();
        const panelW = menu.offsetWidth || 176;
        const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - panelW - 12));
        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(rect.bottom + 6) + "px";
    }

    function closeActiveMenu() {
        if (!activeMenu || !activeBtn) return;
        activeMenu.classList.remove("dropdown--open");
        activeMenu.classList.remove("show"); // Compatibility with both class names
        activeBtn.setAttribute("aria-expanded", "false");
        activeMenu.hidden = true;
        activeMenu = null;
        activeBtn = null;
    }

    function openMenu(btn, menu) {
        if (activeMenu && activeMenu !== menu) {
            closeActiveMenu();
        }

        menu.hidden = false;
        positionMenuPanel(btn, menu);
        
        // Force a reflow for animation
        menu.offsetWidth; 
        
        menu.classList.add("dropdown--open");
        menu.classList.add("show");
        btn.setAttribute("aria-expanded", "true");
        activeMenu = menu;
        activeBtn = btn;
    }

    function toggleMenu(btn, menu) {
        if (!menu.hidden && (menu.classList.contains("dropdown--open") || menu.classList.contains("show"))) {
            closeActiveMenu();
            return;
        }
        openMenu(btn, menu);
    }

    triggers.forEach(btn => {
        const targetId = btn.id.replace('-btn', '');
        const menu = document.getElementById(targetId) || document.getElementById(targetId + '-menu');
        if (!menu) return;

        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            toggleMenu(btn, menu);
        }, true);

        menu.querySelectorAll('[role="menuitem"], a').forEach((link) => {
            link.addEventListener("click", closeActiveMenu);
        });
    });

    document.addEventListener("click", (e) => {
        if (!activeMenu) return;
        const target = e.target;
        if (!target || activeMenu.contains(target) || activeBtn.contains(target)) return;
        closeActiveMenu();
    }, true);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeActiveMenu();
    });

    // Handle scroll/resize for dropdown positioning
    window.addEventListener("scroll", () => {
        if (activeMenu && activeBtn) positionMenuPanel(activeBtn, activeMenu);
    }, { passive: true });

    window.addEventListener("resize", () => {
        if (activeMenu && activeBtn) positionMenuPanel(activeBtn, activeMenu);
    }, { passive: true });


    // --- CAROUSEL LOGIC ---
    const carousel = document.querySelector('.carousel__track');
    const prevBtn = document.querySelector('.carousel__arrow--prev');
    const nextBtn = document.querySelector('.carousel__arrow--next');

    function scrollCarousel(dir) {
        if (!carousel) return;
        const gapStr = getComputedStyle(carousel).gap;
        const gap = parseFloat(gapStr) || 20;
        const card = carousel.querySelector('.plan-card');
        const amount = card ? card.getBoundingClientRect().width + gap : 320;
        carousel.scrollBy({ left: dir * amount, behavior: "smooth" });
    }

    if (prevBtn) prevBtn.addEventListener("click", () => scrollCarousel(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => scrollCarousel(1));


    // --- MISC ---
    // Update year in footer
    const y = document.getElementById("y");
    if (y) y.textContent = String(new Date().getFullYear());
});
