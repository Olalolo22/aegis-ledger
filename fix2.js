const fs = require('fs');
let c = fs.readFileSync('src/app/page.tsx', 'utf8');
c = c.replace(/<\/div>ass="audit-action">/, '<span className="audit-action">');
fs.writeFileSync('src/app/page.tsx', c);
console.log('Fixed audit-action');
