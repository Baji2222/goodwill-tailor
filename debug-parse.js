const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const start = s.indexOf('<script>');
const end = s.lastIndexOf('</script>');
if (start === -1 || end === -1) {
  console.log('missing script tags');
  process.exit(1);
}
const js = s.slice(start + 8, end);
fs.writeFileSync('.tmp-check.js', js);
console.log('extracted script length', js.length);
try {
  new Function(js);
  console.log('JS syntax OK');
} catch (e) {
  console.log('JS syntax ERROR');
  console.log(e.stack || e.message);
  process.exit(1);
}
