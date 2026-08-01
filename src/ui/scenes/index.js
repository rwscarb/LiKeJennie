// Scene registry: 12 slide descriptors, in panel order.
import { buildS0  } from './s0.js';
import { buildS1  } from './s1.js';
import { buildS2  } from './s2.js';
import { buildS3  } from './s3.js';
import { buildS4  } from './s4.js';
import { buildS5  } from './s5.js';
import { buildS6  } from './s6.js';
import { buildS7  } from './s7.js';
import { buildS8  } from './s8.js';
import { buildS10 } from './s10.js';
import { buildS11 } from './s11.js';
import { buildS12 } from './s12.js';

export const scenes = [
  { id: 'divisor-lattice',   num: '01', label: 'DIVISOR LATTICE',   build: buildS0  },
  { id: '189-convergence',   num: '02', label: '1/89 CONVERGENCE',  build: buildS1  },
  { id: 'phi-sphere',        num: '03', label: 'φ SPHERE',          build: buildS2  },
  { id: 'moe-routing',       num: '04', label: 'MoE ROUTING',       build: buildS3  },
  { id: 'greek-letters',     num: '05', label: 'GREEK LETTERS',     build: buildS4  },
  { id: 'sunflower',         num: '06', label: 'SUNFLOWER',         build: buildS5  },
  { id: 'trit-matrix',       num: '07', label: 'TRIT MATRIX',       build: buildS6  },
  { id: 'mod9-orbit',        num: '08', label: 'HELIX',             build: buildS7  },
  { id: 'clock',             num: '09', label: 'CLOCK',             build: buildS8  },
  { id: 'orbit-cycle',       num: '10', label: 'ORBIT CYCLE',       build: buildS10 },
  { id: 'oliver42',          num: '11', label: 'OLIVER 42',         build: buildS11 },
  { id: 'experiments',       num: '12', label: 'EXPERIMENTS',       build: buildS12 },
];