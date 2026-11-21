// CI fails on missing audit data or moderate/high/critical production advisories.
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (report.error || !report.metadata?.vulnerabilities) {
  console.error('Dependency audit did not complete successfully'); process.exit(1);
}
const counts = report.metadata.vulnerabilities;
console.log(JSON.stringify(counts));
if (counts.moderate || counts.high || counts.critical) process.exit(1);
