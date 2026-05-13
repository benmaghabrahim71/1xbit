// Navigation Dropdown Functionality
document.addEventListener('DOMContentLoaded', function() {
    // Handle dropdown menus
    const dropdownTriggers = document.querySelectorAll('.nav-dropdown-trigger');
    
    dropdownTriggers.forEach(trigger => {
        trigger.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const isExpanded = this.getAttribute('aria-expanded') === 'true';
            const menuId = this.id.replace('-btn', '');
            
            // Close all other dropdowns
            dropdownTriggers.forEach(otherTrigger => {
                if (otherTrigger !== this) {
                    otherTrigger.setAttribute('aria-expanded', 'false');
                    const otherMenuId = otherTrigger.id.replace('-btn', '');
                    const otherMenu = document.getElementById(otherMenuId + '-menu');
                    if (otherMenu) {
                        otherMenu.classList.remove('show');
                    }
                }
            });
            
            // Toggle current dropdown
            this.setAttribute('aria-expanded', !isExpanded);
            const menu = document.getElementById(menuId + '-menu');
            if (menu) {
                menu.classList.toggle('show');
            }
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', function() {
        dropdownTriggers.forEach(trigger => {
            trigger.setAttribute('aria-expanded', 'false');
            const menuId = trigger.id.replace('-btn', '');
            const menu = document.getElementById(menuId + '-menu');
            if (menu) {
                menu.classList.remove('show');
            }
        });
    });
    
    // Mobile menu toggle (if exists)
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');
    
    if (mobileMenuToggle && mobileMenu) {
        mobileMenuToggle.addEventListener('click', function() {
            mobileMenu.classList.toggle('show');
            this.setAttribute('aria-expanded', 
                this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'
            );
        });
    }
    
    // Smooth scroll for anchor links
    const anchorLinks = document.querySelectorAll('a[href^="#"]');
    anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                e.preventDefault();
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
});

// Add CSS for dropdown functionality
const dropdownStyles = `
    .nav-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        background: white;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: 0 4px 6px var(--shadow);
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all 0.2s ease;
        z-index: 1000;
    }
    
    .nav-dropdown-menu.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }
    
    .nav-dropdown-menu a {
        display: block;
        padding: 0.75rem 1rem;
        color: var(--text);
        text-decoration: none;
        transition: background-color 0.2s ease;
    }
    
    .nav-dropdown-menu a:hover {
        background-color: var(--surface);
        text-decoration: none;
    }
    
    .mobile-menu {
        display: none;
    }
    
    @media (max-width: 768px) {
        .mobile-menu {
            display: block;
        }
        
        .nav-bar__list {
            flex-direction: column;
            gap: 0.5rem;
        }
    }
`;

// Inject styles if not already present
if (!document.querySelector('#dropdown-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'dropdown-styles';
    styleSheet.textContent = dropdownStyles;
    document.head.appendChild(styleSheet);
}
