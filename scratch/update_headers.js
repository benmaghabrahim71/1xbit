const fs = require('fs');
const path = require('path');

const seoTags = `
  <meta name="description" content="HOST1TOP — Premium 10Gb/s Game & Cloud Hosting. SA-MP, MTA:SA, Minecraft, RDP and VPS hosting with 99.9% uptime." />
  <meta name="keywords" content="hosting, vps, rdp, game server, minecraft hosting, samp hosting, cloud hosting, 10Gbps, host1top, premium hosting" />
  <meta name="author" content="HOST1TOP" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://host1top.com/" />
  <meta property="og:title" content="HOST1TOP — Integrity, Efficiency, and Speed 10Gb/s" />
  <meta property="og:description" content="Premium 10Gb/s Game & Cloud Hosting. SA-MP, MTA:SA, Minecraft, RDP and VPS hosting with 99.9% uptime." />
  <meta property="og:image" content="https://host1top.com/img/og-image.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="https://host1top.com/" />
  <meta name="twitter:title" content="HOST1TOP — Integrity, Efficiency, and Speed 10Gb/s" />
  <meta name="twitter:description" content="Premium 10Gb/s Game & Cloud Hosting. SA-MP, MTA:SA, Minecraft, RDP and VPS hosting with 99.9% uptime." />
  <meta name="twitter:image" content="https://host1top.com/img/og-image.jpg" />
  <link rel="canonical" href="https://host1top.com/" />`;

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'scratch') {
                processDir(fullPath);
            }
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;

            // Replace UI Header
            const headerRegex = /<div class="utility-bar">[\s\S]*?<\/header>/g;
            if (headerRegex.test(content)) {
                content = content.replace(headerRegex, '<div id="header-root"></div>');
                changed = true;
            }

            // Clean up old SVG symbols block that was hardcoded
            const svgRegex = /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="svg-symbols"[\s\S]*?<\/svg>/g;
            if (svgRegex.test(content)) {
                content = content.replace(svgRegex, '');
                changed = true;
            }
            
            // Fix double </header>
            content = content.replace(/<\/header>\s*<\/header>/g, '</header>');

            // Check if header-loader.js is included
            if (!content.includes('header-loader.js')) {
                let scriptPath = 'header-loader.js';
                if (fullPath.includes('plans')) {
                   scriptPath = '../header-loader.js';
                }
                content = content.replace(/<\/body>/, `  <script src="${scriptPath}"></script>\n</body>`);
                changed = true;
            }

            // Replace Footer
            const footerRegex = /<footer class="site-footer"[\s\S]*?<\/footer>/g;
            if (footerRegex.test(content)) {
                content = content.replace(footerRegex, '<div id="footer-root"></div>');
                changed = true;
            }

            // Apply SEO tags
            if (!content.includes('og:title') && file !== 'index.html') {
                content = content.replace(/<meta name="description"[\s\S]*?\/>/g, '');
                content = content.replace(/<\/head>/, `${seoTags}\n</head>`);
                changed = true;
            }

            // Clean up trailing hardcoded dropdown menus
            const gameMenuRegex = /<ul class="dropdown" id="game-menu" role="menu" hidden>[\s\S]*?<\/ul>/g;
            const rdpMenuRegex = /<ul class="dropdown" id="rdp-menu" role="menu" hidden>[\s\S]*?<\/ul>/g;
            const vpsMenuRegex = /<ul class="dropdown" id="vps-menu" role="menu" hidden>[\s\S]*?<\/ul>/g;

            if (gameMenuRegex.test(content)) { content = content.replace(gameMenuRegex, ''); changed = true; }
            if (rdpMenuRegex.test(content)) { content = content.replace(rdpMenuRegex, ''); changed = true; }
            if (vpsMenuRegex.test(content)) { content = content.replace(vpsMenuRegex, ''); changed = true; }

            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log(`Updated ${fullPath}`);
            }
        }
    }
}

processDir(path.join(__dirname, '..'));
