const fs = require('fs');
let content = fs.readFileSync('src/app/page.tsx', 'utf8');

const htmlStart = content.indexOf('__html: `') + 9;
const htmlEnd = content.lastIndexOf('` }}');

let html = content.substring(htmlStart, htmlEnd);

// Convert HTML to JSX
html = html.replace(/class=/g, 'className=')
           .replace(/<!--(.*?)-->/g, '{/* $1 */}')
           .replace(/<br>/g, '<br />')
           .replace(/<hr>/g, '<hr />');

// Convert inline styles: style="transition-delay: 0.1s; margin-bottom: 60px;" -> style={{ transitionDelay: '0.1s', marginBottom: '60px' }}
html = html.replace(/style="([^"]*)"/g, (match, styleStr) => {
    const rules = styleStr.split(';').filter(r => r.trim().length > 0);
    const obj = rules.map(rule => {
        let [key, val] = rule.split(':');
        key = key.trim().replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        val = val.trim();
        return `${key}: '${val}'`;
    }).join(', ');
    return `style={{ ${obj} }}`;
});

// Remove dangerouslySetInnerHTML and replace with the parsed JSX
const before = content.substring(0, content.indexOf('<div dangerouslySetInnerHTML'));
const after = content.substring(content.lastIndexOf('/>') + 2);

const finalContent = `${before}<div>\n${html}\n        </div>${after}`;

fs.writeFileSync('src/app/page.tsx', finalContent);
console.log('Converted HTML to JSX in page.tsx');
