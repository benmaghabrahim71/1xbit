const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'scratch') processDir(fullPath);
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;
            if (content.includes('<div id="header-root"></div></header>')) {
                content = content.replace(/<div id="header-root"><\/div><\/header>/g, '<div id="header-root"></div>');
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log('Fixed ' + fullPath);
            }
        }
    }
}
processDir(path.join(__dirname, '..'));
