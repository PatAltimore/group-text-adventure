const fs = require('fs');

// Step 1: Strip ALL solvedDescription lines from a file
function stripSDs(text) {
  // Remove all SD lines
  text = text.replace(/^[ \t]*"solvedDescription":[ \t]*"(?:[^"\\]|\\.)*",?\n/gm, '');
  // Fix trailing commas before } (caused by removing last property)
  text = text.replace(/,(\s*\})/g, '$1');
  return text;
}

// Step 2: Insert SDs after each room's "description" line
function insertSDs(text, descs) {
  for (const [roomId, sd] of Object.entries(descs)) {
    const roomIdx = text.indexOf('"' + roomId + '": {');
    if (roomIdx === -1) { console.log('  NOT FOUND: ' + roomId); continue; }
    let descIdx = text.indexOf('"description":', roomIdx);
    if (descIdx === -1) { console.log('  NO DESC: ' + roomId); continue; }
    let q = text.indexOf('"', descIdx + 14);
    let i = q + 1;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') break;
      i++;
    }
    let insertPoint = text.indexOf('\n', i) + 1;
    const line = '      "solvedDescription": ' + JSON.stringify(sd) + ',\n';
    text = text.slice(0, insertPoint) + line + text.slice(insertPoint);
  }
  return text;
}

function processFile(file, descs) {
  let c = fs.readFileSync(file, 'utf8');
  // Normalize to LF
  c = c.replace(/\r\n/g, '\n');
  
  // Strip all existing SDs
  c = stripSDs(c);
  const baseSz = Buffer.byteLength(c);
  
  // Insert new SDs
  c = insertSDs(c, descs);
  
  // Validate
  try { JSON.parse(c); } catch(e) {
    console.log('  INVALID JSON: ' + e.message);
    return;
  }
  
  const finalSz = Buffer.byteLength(c);
  console.log(`  base(noSD): ${baseSz}  final: ${finalSz}  ${finalSz > 30000 ? 'OVER!' : 'OK'}`);
  fs.writeFileSync(file, c, 'utf8');
}

const W = 'world/';

// hollow-moon: base ~30102 without SDs. Budget = -102. Need to REMOVE SDs AND trim.
// But we can only modify SDs. So let's use minimal SDs.
// With 8 SDs at 1 char each: 8 * (30 + 3) = 264. 30102 + 264 = 30366. Still over.
// With 0 SDs: 30102. Still over by 102.
// Issue: the base file (without SDs) has extra content from commit. Let me check after stripping.
console.log('hollow-moon.json:');
processFile(W + 'hollow-moon.json', {
  'command-center': 'Cargo bay open to the west.',
  'drill-site': 'Tunnel blasted open north.',
  'sealed-tunnel': 'Passage cleared north.',
  'hollow-cavern': 'Eastern wall opened.',
  'resonance-chamber': 'North passage opened.',
  'alien-antechamber': 'Doorway north opened.',
  'control-room': 'Iris door opened north.',
  'core-chamber': 'Origin patterns decoded.'
});

// mars-adventure: base 26733, budget 3267. Need to save just 11 from current 3278.
console.log('\nmars-adventure.json:');
processFile(W + 'mars-adventure.json', {
  'cydonia-plateau': 'The broad mesa hums with magnetic anomalies. Your suit seals hold firm, patched and pressure-tested. To the east, the Face on Mars rises from the plateau. The dust plains are south.',
  'face-of-mars': 'The colossal carved face looms above, unmistakably deliberate. The mouth has been cleared, revealing a passage north. Fitted stonework gleams beneath the weathered exterior. The Cydonia plateau is west.',
  'face-entrance': 'Inside the mouth of the Face on Mars. Geometric patterns spiral inward, crystalline minerals glittering. Warm air rises from below. The descent is secured with anchoring bolts. The exterior is south. A passage descends east.',
  'artifact-chamber': 'The hexagonal chamber hums with catalogued artifacts. The central plinth panel revealed the crystal key. Dense inscriptions cover every surface. The corridor is south. A passage east leads toward the pyramid.',
  'pyramid-chamber': 'The Pyramid interior soars above, metallic panels pulsing with awakened energy. The crystalline column glows brighter. The artifact chamber is west. The sealed doorway north stands open, revealing the Nexus Core.',
  'nexus-core': 'The spherical chamber blazes with amber light. The mechanism spins with purpose, holographic projections stabilized. Star maps, planetary diagrams, and the complete Martian codex. The pyramid interior is south.'
});

// mystery-house: base 27606, budget 2394. Current SDs = 3430. Need to save 1036.
console.log('\nmystery-house.json:');
processFile(W + 'mystery-house.json', {
  'library': 'Books reach toward a vaulted ceiling. Grimoires and journals remain. The air smells of leather. A desk buried in papers. Entrance hall west. The door north stands ajar, symbols dark.',
  'parlor': 'A sitting room of rot and shadow. A ghost of lavender. A yellowed piano. Photographs of the Blackwoods with faces scratched. Entrance hall east. Southern door open, warm air from the greenhouse.',
  'kitchen': 'A cavernous kitchen. Copper pots green with verdigris. The stove radiates warmth. Butcher block scarred dark. Dining room south. Meat locker west bolted. Cellar door east open, cold air rising.',
  'conservatory': 'The glass room feels gentler now. Dead plants remain but the menace has faded. Rain drums against the panes. The fountain stands peaceful. Dining room west. Greenhouse south, safe to traverse.',
  'greenhouse': 'The humid glass structure is cooling. Carnivorous plants droop, thorned vines limp. The willow tree stands quiet, its dark heart shattered. Gentle lights drift upward. Conservatory north.',
  'cellar': 'Stone steps into the cellar. The chill is receding. Wine racks in darkness. Chains slack. The coffin open, occupant reduced to ash. Carved ceiling: REST ETERNAL, BARTHOLOMEW BLACKWOOD.'
});

// paranormal-mysteries: base 28019, budget 1981. Current 2813. Need to save 832.
console.log('\nparanormal-mysteries.json:');
processFile(W + 'paranormal-mysteries.json', {
  'abandoned-lab': 'A Cold War bunker. Rusted signs and sagging chain-link. The specimen vault south is unlocked, chamber below. Area 51 entrance is north.',
  'underground-chamber': 'A vault in bedrock, specimens lining steel shelves. Fluorescent tubes flicker. The archway west stands open, bioluminescence pulsing from the vessel beyond.',
  'alien-spacecraft': 'Bio-organic walls pulse blue to violet. Navigation console glows. A portal north has opened, connecting to a distant crash site. The chamber is east.',
  'area-51-entrance': 'Chain-link and razor wire. Turrets stand silent. The main gate north hangs open, the hangar accessible. The abandoned lab is south.',
  'bermuda-monitoring': 'The underwater station holds steady, hull reinforced. Instruments record stable readings. The Stonehenge portal is east.',
  'stonehenge': 'The ancient stones hum with activated energy. A star map materializes at the center, projected by the stones. Bermuda station is west.'
});

// pirate-treasure: base 28699, budget 1301. Current 2262. Need to save 961.
console.log('\npirate-treasure.json:');
processFile(W + 'pirate-treasure.json', {
  'shipwreck-beach': 'Black sand between coral. Ships rot in shallows. A hidden cove revealed to the south. Jungle trail north.',
  'ruined-fort': 'Crumbling pirate fortress in vines. Cannons rust. The lookout tower door east forced open. Jungle west.',
  'mangrove-swamp': 'Black mud and roots. Quicksand patches mapped safe. Skull cave east. Shipwreck beach north.',
  'skull-cave-entrance': 'Cave mouth, skull lintel. Torchlight illuminates the interior. Passage south to underground river. Swamp west.',
  'trap-corridor': 'Fitted stone with disarmed traps. The treasure vault door south stands unlocked. Underground river north.'
});

// true-crime: base 27541, budget 2459. Current 3299. Need to save 840.
console.log('\ntrue-crime.json:');
processFile(W + 'true-crime.json', {
  'precinct-office': 'Fluorescent lights paint everything old-coffee color. Desk buried in case files. Bulletin board connects the evidence. Probable cause established \u2014 interrogation room west now open. Forensics lab north.',
  'crane-mansion-foyer': 'Crystal chandeliers, half the bulbs dead. Marble veined black. Fiber analysis revealed a trail east \u2014 the master bedroom door open, crime scene tape at the threshold. Parlor west. Front steps south.',
  'master-bedroom': "Helena Crane's domain. Military-precision bed. Vanity of prescriptions and scattered jewelry. A hidden compartment revealed a burner phone. The foyer is west.",
  'forensics-lab': 'White tile, steel, antiseptic air. Security footage analyzed \u2014 a complete case file compiled from the evidence. The precinct is south.',
  'back-alley': 'Rain pools in broken asphalt, neon stuttering. Dumpsters overflow. The threat neutralized. A cufflink trace leads south to the parking garage. Precinct north.',
  'warehouse-office': "Marcus Webb's real books in this shipping container office. The thugs dealt with, office clear. Filing cabinets line the walls. The dock is south.",
  'interrogation-room': 'Bare walls, table, chairs, one-way mirror. Harsh light. The suspect broken, murder solved. The truth sits heavy. Precinct office east.'
});
