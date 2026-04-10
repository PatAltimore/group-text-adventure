const { execSync } = require('child_process');
const fs = require('fs');

// Compare pre-SD version with current stripped version for each file
const files = [
  ['hollow-moon', 'HEAD~1'],
  ['mars-adventure', 'HEAD~1'],
  ['mystery-house', 'HEAD~1'],
  ['paranormal-mysteries', 'HEAD~1'],
  ['pirate-treasure', 'HEAD~1'],
  ['true-crime', 'HEAD~1']
];

files.forEach(([f, ref]) => {
  const pre = execSync(`git show ${ref}:world/${f}.json`).toString('utf8');
  const cur = fs.readFileSync(`world/${f}.json`, 'utf8');
  
  // Strip SDs and fix commas
  let stripped = cur.replace(/^[ \t]*"solvedDescription":[ \t]*"(?:[^"\\]|\\.)*",?\n/gm, '');
  stripped = stripped.replace(/,(\s*\})/g, '$1');
  
  const preSz = Buffer.byteLength(pre);
  const strSz = Buffer.byteLength(stripped);
  const diff = strSz - preSz;
  
  if (diff !== 0) {
    console.log(`\n${f}: pre=${preSz} stripped=${strSz} diff=${diff}`);
    // Find first difference
    for (let i = 0; i < Math.max(pre.length, stripped.length); i++) {
      if (pre[i] !== stripped[i]) {
        console.log(`  First diff at char ${i}`);
        console.log('  pre:', JSON.stringify(pre.slice(Math.max(0, i - 50), i + 50)));
        console.log('  str:', JSON.stringify(stripped.slice(Math.max(0, i - 50), i + 50)));
        break;
      }
    }
  } else {
    console.log(`${f}: MATCH ✅`);
  }
});
