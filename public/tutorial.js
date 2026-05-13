// Host1Top V1.6 Onboarding Tutorial
document.addEventListener('DOMContentLoaded', () => {
    // Check if the tutorial has been seen
    if (localStorage.getItem('host1top_v16_tutorial_seen')) {
        return;
    }

    // Tutorial Data
    const tutorialSteps = [
        {
            title: "Welcome to V1.6",
            text: "Discover the completely redesigned Host1Top experience. We've rebuilt everything from the ground up for maximum speed and usability.",
            icon: `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-dark);"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`
        },
        {
            title: "Next-Gen Hardware",
            text: "Experience the raw power of our new AMD Ryzen™ 9 9950X nodes and DDR5 memory, delivering unmatched performance for your applications.",
            icon: `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-dark);"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`
        },
        {
            title: "Advanced Protection",
            text: "PletX Anti-DDoS is now deeply integrated, protecting your servers against Layer 3/4 and Layer 7 attacks without any configuration required.",
            icon: `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-dark);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`
        }
    ];

    let currentStep = 0;

    // Create Modal HTML
    const modalHTML = `
        <div id="v16-tutorial-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 99999; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.4s ease;">
            <div id="v16-tutorial-modal" style="background: #fff; border-radius: 24px; padding: 3rem 2rem 2rem; width: 90%; max-width: 450px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); transform: translateY(20px); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); position: relative;">
                
                <button id="tutorial-skip-top" style="position: absolute; top: 1rem; right: 1.5rem; background: none; border: none; font-size: 0.8rem; font-weight: 700; color: var(--muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em;">Skip</button>

                <div id="tutorial-icon-container" style="margin-bottom: 2rem; display: flex; justify-content: center; align-items: center; height: 100px;">
                    ${tutorialSteps[0].icon}
                </div>

                <h2 id="tutorial-title" style="font-size: 1.75rem; font-weight: 800; margin-bottom: 1rem; color: var(--text);">${tutorialSteps[0].title}</h2>
                <p id="tutorial-text" style="color: var(--muted); font-size: 1rem; line-height: 1.6; margin-bottom: 2.5rem; min-height: 80px;">${tutorialSteps[0].text}</p>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div id="tutorial-dots" style="display: flex; gap: 0.5rem;">
                        <div class="dot active" style="width: 24px; height: 8px; border-radius: 4px; background: var(--accent-dark); transition: all 0.3s ease;"></div>
                        <div class="dot" style="width: 8px; height: 8px; border-radius: 4px; background: #e5e5e5; transition: all 0.3s ease;"></div>
                        <div class="dot" style="width: 8px; height: 8px; border-radius: 4px; background: #e5e5e5; transition: all 0.3s ease;"></div>
                    </div>
                    
                    <button id="tutorial-next" class="btn btn--primary" style="padding: 0.75rem 2rem; border-radius: 99px;">Next</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('v16-tutorial-overlay');
    const modal = document.getElementById('v16-tutorial-modal');
    const titleEl = document.getElementById('tutorial-title');
    const textEl = document.getElementById('tutorial-text');
    const iconContainer = document.getElementById('tutorial-icon-container');
    const dots = document.querySelectorAll('.dot');
    const nextBtn = document.getElementById('tutorial-next');
    const skipTopBtn = document.getElementById('tutorial-skip-top');

    // Show modal with animation
    setTimeout(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'translateY(0)';
    }, 500);

    const updateModal = () => {
        // Simple fade out/in effect for content
        titleEl.style.opacity = '0';
        textEl.style.opacity = '0';
        iconContainer.style.opacity = '0';
        iconContainer.style.transform = 'scale(0.8)';
        
        setTimeout(() => {
            titleEl.textContent = tutorialSteps[currentStep].title;
            textEl.textContent = tutorialSteps[currentStep].text;
            iconContainer.innerHTML = tutorialSteps[currentStep].icon;

            dots.forEach((dot, index) => {
                if (index === currentStep) {
                    dot.style.width = '24px';
                    dot.style.background = 'var(--accent-dark)';
                } else {
                    dot.style.width = '8px';
                    dot.style.background = '#e5e5e5';
                }
            });

            if (currentStep === tutorialSteps.length - 1) {
                nextBtn.textContent = 'Explore Now';
            } else {
                nextBtn.textContent = 'Next';
            }

            titleEl.style.opacity = '1';
            textEl.style.opacity = '1';
            iconContainer.style.opacity = '1';
            iconContainer.style.transform = 'scale(1)';
        }, 200);
        
        // Add transition styles dynamically
        titleEl.style.transition = 'opacity 0.2s ease';
        textEl.style.transition = 'opacity 0.2s ease';
        iconContainer.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    };

    const closeTutorial = () => {
        localStorage.setItem('host1top_v16_tutorial_seen', 'true');
        overlay.style.opacity = '0';
        modal.style.transform = 'translateY(20px)';
        setTimeout(() => {
            overlay.remove();
        }, 400);
    };

    nextBtn.addEventListener('click', () => {
        if (currentStep < tutorialSteps.length - 1) {
            currentStep++;
            updateModal();
        } else {
            closeTutorial();
        }
    });

    skipTopBtn.addEventListener('click', closeTutorial);
});
